/**
 * File → template conversion.
 *
 * Turns an uploaded PDF or Excel checklist into a {@link TemplateSpec} in one
 * headless Claude call. PDFs are handed to Claude natively as a document block
 * (it reads layout, tables and check-boxes directly); Excel/CSV files are parsed
 * to text with SheetJS first, since spreadsheets carry no useful visual layout.
 *
 * The model is given the same `proposeTemplate` tool the chat agent uses, so the
 * output is the identical tiny spec — `buildTemplateContentFromSpec` (inside
 * `templates.createFromSpec`) does the heavy lifting of producing valid content.
 */
import Anthropic from '@anthropic-ai/sdk';
import { parseTemplateSpec, type TemplateSpec } from '@forma360/shared/template-spec';
import { env } from './env';
import { PROPOSE_TEMPLATE_TOOL } from './template-agent';
import { isExcelLike, isPdf, workbookToText } from './template-import-xlsx';

const IMPORT_SYSTEM_PROMPT = `You convert existing inspection checklists and forms into Forma360 inspection templates.

You are given a source document (a PDF form or a spreadsheet exported to text). Read it carefully and reproduce its structure as faithfully as you can, then call the proposeTemplate tool with the result. Rules:
- Preserve the document's own sections, ordering and wording as closely as possible. Do not invent extra questions that aren't implied by the source, and don't drop questions that are there.
- Infer the right question type per row: a pass/fail or yes/no checklist item is multipleChoice; a measurement is number (with its unit); "attach a photo" is media; a sign-off line is signature; a heading or note with no answer is instruction. For a person who is a system user (operator, inspector, driver) use type "user" (not text); for a tracked asset/vehicle/equipment use "asset"; for a site use "site" and an area "location". Use "text" only for genuinely free-form fields.
- For multipleChoice, use the answer options the document implies (e.g. Pass/Fail/N/A, OK/Defect, Compliant/Non-compliant). Flag and colour the unsafe/failing option red. Reuse the EXACT same options (including any triggers) across every question that shares a scale so they collapse into one shared response set — keep the number of distinct response sets to a minimum. Do NOT vary a requireAction title per question on a shared scale (that creates a separate set for each); omit requireAction or use one identical generic title across all of them.
- Where a failing answer clearly warrants proof or a follow-up, add requireEvidence or a requireAction title — but only when the source makes that intent obvious.
- Write everything in the language of the source document.
Call proposeTemplate exactly once with the full converted template. Do not ask the user questions.`;

const MODEL = 'claude-opus-4-8';

function buildUserContent(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Anthropic.ContentBlockParam[] {
  const { filename, mimeType, bytes } = input;

  if (isPdf(filename, mimeType)) {
    const base64 = Buffer.from(bytes).toString('base64');
    return [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 },
      },
      {
        type: 'text',
        text: `Convert this inspection form ("${filename}") into a Forma360 template by calling proposeTemplate.`,
      },
    ];
  }

  if (isExcelLike(filename, mimeType)) {
    const text = workbookToText(bytes);
    if (text.trim().length === 0) {
      throw new Error('The spreadsheet appears to be empty.');
    }
    return [
      {
        type: 'text',
        text: `Convert this spreadsheet checklist ("${filename}") into a Forma360 template by calling proposeTemplate. The sheets, as CSV:\n\n${text}`,
      },
    ];
  }

  throw new Error('Unsupported file type. Upload a PDF or Excel (.xlsx/.xls) file.');
}

/**
 * Convert an uploaded file into a validated TemplateSpec. Throws on unsupported
 * files, empty content, or if the model fails to produce a valid spec.
 */
export async function convertFileToSpec(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<TemplateSpec> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildUserContent(input) }];

  let attempts = 0;
  while (true) {
    attempts += 1;
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      system: IMPORT_SYSTEM_PROMPT,
      tools: [PROPOSE_TEMPLATE_TOOL],
      messages,
    });
    const finalMsg = await stream.finalMessage();

    const proposeBlock = finalMsg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'proposeTemplate',
    );

    if (proposeBlock !== undefined) {
      try {
        return parseTemplateSpec(proposeBlock.input);
      } catch (err) {
        if (attempts > 3) throw err instanceof Error ? err : new Error('Invalid template spec');
        messages.push({ role: 'assistant', content: finalMsg.content });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: proposeBlock.id,
              content: `The template spec was invalid: ${
                err instanceof Error ? err.message : 'unknown error'
              }. Call proposeTemplate again with a corrected spec.`,
              is_error: true,
            },
          ],
        });
        continue;
      }
    }

    // The model replied without calling the tool — nudge it once or twice.
    if (attempts > 3) {
      throw new Error('Could not convert the file into a template.');
    }
    messages.push({ role: 'assistant', content: finalMsg.content });
    messages.push({
      role: 'user',
      content: 'Please convert the document into a template now by calling proposeTemplate.',
    });
  }
}
