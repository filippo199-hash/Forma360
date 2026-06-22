/**
 * Legal + informational page content (privacy, terms, data deletion, about,
 * contact). Plain data so it stays out of the i18n lint rule and lives in one
 * place. English-only by design — these are review/legal documents.
 *
 * NOTE: This content is a thorough, good-faith starting point written for
 * Meta App Review and general transparency. It is not a substitute for advice
 * from qualified legal counsel; have it reviewed before relying on it.
 */
import { COMPANY } from './site';

export interface LegalSection {
  heading: string;
  /** Paragraphs of body text. */
  body?: string[];
  /** Optional bullet list rendered after the body. */
  bullets?: string[];
}

export interface LegalDoc {
  title: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
}

export const PRIVACY_POLICY: LegalDoc = {
  title: 'Privacy Policy',
  updated: COMPANY.lastUpdated,
  intro: [
    `${COMPANY.legalEntity}, with its registered office at ${COMPANY.address} (“we”, “us”, “our”), operates the Forma360 operational-excellence platform at ${COMPANY.website}, including its AI assistant on the web and over WhatsApp. This Privacy Policy explains what personal data we collect, how we use it, who we share it with, and the rights you have. We are the data controller for the personal data described below.`,
    `If you have any questions about this policy or how we handle your data, contact us at ${COMPANY.privacyEmail}.`,
  ],
  sections: [
    {
      heading: '1. Who this policy covers',
      body: [
        'This policy applies to people who create or use a Forma360 account, members of organisations (“tenants”) that use Forma360, and anyone who contacts our AI assistant — including over WhatsApp.',
      ],
    },
    {
      heading: '2. Data we collect',
      body: ['We collect the following categories of personal data:'],
      bullets: [
        'Account data: your name, email address, and (optionally) phone number, plus your role and permissions within your organisation.',
        'Operational data you enter: inspections, issues, corrective actions, assets, documents, schedules and related content created within your organisation’s workspace.',
        'AI assistant conversations: the messages you send to the assistant and the responses it generates, stored so you can review your conversation history.',
        'WhatsApp data: if you message our assistant on WhatsApp, we receive your WhatsApp phone number, your message content, and basic metadata (such as timestamps) from the WhatsApp Business Platform, in order to identify your account and reply to you.',
        'Technical data: log data, request identifiers, and error diagnostics used to operate, secure and debug the service.',
      ],
    },
    {
      heading: '3. How we use your data',
      body: ['We use personal data to:'],
      bullets: [
        'Provide, maintain and secure the Forma360 platform and your organisation’s workspace.',
        'Operate the AI assistant: match your WhatsApp number to your Forma360 account, scope requests to your organisation’s data, generate answers, and send replies.',
        'Authenticate you (passwordless email one-time codes) and manage permissions.',
        'Send service communications, such as verification codes and notifications you have configured.',
        'Diagnose problems, prevent abuse, and improve the service.',
        'Comply with legal obligations.',
      ],
    },
    {
      heading: '4. Legal bases (UK/EU GDPR)',
      body: [
        'We rely on the following legal bases: performance of a contract (to provide the service to you and your organisation); our legitimate interests (to secure, operate and improve the service); your consent where required; and compliance with legal obligations. Where our legitimate interests apply, we have assessed that they are not overridden by your rights.',
      ],
    },
    {
      heading: '5. The AI assistant and third-party AI processing',
      body: [
        'To generate answers, the assistant sends the relevant conversation and a scoped, read-only summary of your organisation’s data to our AI model provider, Anthropic, which processes it to produce a response. We do not use your data to train third-party models. The assistant only retrieves data belonging to your own organisation.',
      ],
    },
    {
      heading: '6. WhatsApp messaging',
      body: [
        'Our WhatsApp assistant is provided through the WhatsApp Business Platform operated by Meta. When you message us on WhatsApp, Meta processes your message to deliver it to us and to deliver our replies to you, in accordance with Meta’s and WhatsApp’s own terms and privacy policies. We use your WhatsApp number solely to identify your Forma360 account and to respond to you. You can stop messaging the assistant at any time, and you can ask us to unlink your number (see “Your rights” and our Data Deletion page).',
      ],
    },
    {
      heading: '7. Sharing and sub-processors',
      body: [
        'We do not sell your personal data. We share it only with service providers (“sub-processors”) that help us run the platform, under contracts that require them to protect it:',
      ],
      bullets: [
        'Anthropic — AI model processing for the assistant.',
        'Meta Platforms / WhatsApp — delivery of WhatsApp messages.',
        'Cloud infrastructure and database hosting providers — to run the application and store data.',
        'Object storage and email delivery providers — for file attachments and transactional email.',
        'Error-monitoring and logging providers — to keep the service reliable and secure.',
        'We may also disclose data where required by law, or to protect our rights, users or the public.',
      ],
    },
    {
      heading: '8. International transfers',
      body: [
        'Some of our providers process data outside the UK/EEA. Where that happens, we rely on appropriate safeguards such as the UK International Data Transfer Agreement, EU Standard Contractual Clauses, or an adequacy decision.',
      ],
    },
    {
      heading: '9. Retention',
      body: [
        'We keep personal data for as long as your account or your organisation’s workspace is active, and as needed to provide the service. Conversation history is retained until you or your organisation delete it. When data is no longer needed, we delete or anonymise it. We may retain limited records where required for legal, security or accounting purposes.',
      ],
    },
    {
      heading: '10. Security',
      body: [
        'We use technical and organisational measures to protect personal data, including encryption in transit, strict tenant isolation, role-based access controls, and signed, verified webhooks for WhatsApp traffic. No system is perfectly secure, but we work continuously to protect your data.',
      ],
    },
    {
      heading: '11. Your rights',
      body: [
        'Subject to applicable law, you have the right to access, correct, delete, or port your personal data, to object to or restrict certain processing, and to withdraw consent. To exercise these rights — including unlinking your WhatsApp number or deleting your data — contact us at ' +
          COMPANY.privacyEmail +
          ' or see our Data Deletion page. You also have the right to complain to your data protection authority (in the UK, the Information Commissioner’s Office).',
      ],
    },
    {
      heading: '12. Children',
      body: [
        'Forma360 is a workplace tool and is not directed to children. We do not knowingly collect data from anyone under 16.',
      ],
    },
    {
      heading: '13. Changes to this policy',
      body: [
        'We may update this policy from time to time. We will change the “last updated” date above and, where appropriate, notify you. Continued use of the service after an update means you accept the revised policy.',
      ],
    },
    {
      heading: '14. Contact us',
      body: [
        `${COMPANY.legalName} (company number ${COMPANY.companyNumber}), ${COMPANY.address}. Email: ${COMPANY.privacyEmail}.`,
      ],
    },
  ],
};

export const TERMS_OF_SERVICE: LegalDoc = {
  title: 'Terms of Service',
  updated: COMPANY.lastUpdated,
  intro: [
    `These Terms of Service (“Terms”) govern your access to and use of the Forma360 platform and its AI assistant (the “Service”) provided by ${COMPANY.legalEntity}, with its registered office at ${COMPANY.address} (“we”, “us”, “our”). By creating an account or using the Service, you agree to these Terms.`,
  ],
  sections: [
    {
      heading: '1. The Service',
      body: [
        'Forma360 is a multi-tenant operational-excellence platform for inspections, issues, corrective actions, assets, documents and analytics, including an AI assistant available on the web and over WhatsApp. We may add, change or remove features over time.',
      ],
    },
    {
      heading: '2. Accounts and eligibility',
      body: [
        'You must provide accurate information and keep your account secure. You are responsible for activity under your account. You must be at least 16 and able to enter into a binding agreement. Your organisation’s administrator may control your access and permissions.',
      ],
    },
    {
      heading: '3. Acceptable use',
      body: ['You agree not to:'],
      bullets: [
        'Use the Service unlawfully or to send unlawful, harmful, infringing or abusive content.',
        'Attempt to access data belonging to organisations you are not authorised to access.',
        'Disrupt, reverse engineer, or probe the Service except as permitted by law.',
        'Use the WhatsApp assistant to send spam or to violate Meta’s or WhatsApp’s policies.',
      ],
    },
    {
      heading: '4. The AI assistant',
      body: [
        'The assistant generates answers from your organisation’s data using automated AI models. Responses may be incomplete or inaccurate and are provided for convenience; they are not professional advice. You are responsible for verifying important information before relying on it.',
      ],
    },
    {
      heading: '5. WhatsApp messaging',
      body: [
        'The WhatsApp assistant is delivered via the WhatsApp Business Platform and is also subject to Meta’s and WhatsApp’s terms. Standard messaging rates from your carrier may apply. We may rate-limit or suspend WhatsApp access to protect the Service.',
      ],
    },
    {
      heading: '6. Your content',
      body: [
        'You and your organisation retain ownership of the data you submit. You grant us the rights necessary to host and process that data to provide the Service. You are responsible for ensuring you have the right to submit the data you provide.',
      ],
    },
    {
      heading: '7. Intellectual property',
      body: [
        'We and our licensors own the Service, including its software, design and trademarks. These Terms do not grant you any rights in them except the limited right to use the Service.',
      ],
    },
    {
      heading: '8. Disclaimers',
      body: [
        'The Service is provided “as is” and “as available”, without warranties of any kind to the fullest extent permitted by law, including any warranty of merchantability, fitness for a particular purpose, or non-infringement.',
      ],
    },
    {
      heading: '9. Limitation of liability',
      body: [
        'To the fullest extent permitted by law, we will not be liable for indirect, incidental, special or consequential damages, or for loss of profits, data or goodwill. Nothing in these Terms excludes liability that cannot be excluded by law.',
      ],
    },
    {
      heading: '10. Termination',
      body: [
        'You may stop using the Service at any time. We may suspend or terminate access if you breach these Terms or to protect the Service. On termination, your right to use the Service ends; data handling follows our Privacy Policy and Data Deletion page.',
      ],
    },
    {
      heading: '11. Governing law',
      body: [
        `These Terms are governed by the laws of ${COMPANY.jurisdiction}, and disputes are subject to the exclusive jurisdiction of its courts, unless mandatory local law provides otherwise.`,
      ],
    },
    {
      heading: '12. Contact',
      body: [`Questions about these Terms: ${COMPANY.email}.`],
    },
  ],
};

export const DATA_DELETION: LegalDoc = {
  title: 'Data Deletion',
  updated: COMPANY.lastUpdated,
  intro: [
    `You can ask us to delete your personal data, including any data associated with your use of our WhatsApp assistant. This page explains how, what is deleted, and how long it takes.`,
  ],
  sections: [
    {
      heading: 'How to request deletion',
      body: ['You can request deletion in either of these ways:'],
      bullets: [
        `Email ${COMPANY.privacyEmail} from the email address associated with your account, with the subject “Delete my data”. If your request concerns WhatsApp, include the WhatsApp phone number you used.`,
        'Ask your organisation’s administrator to deactivate or anonymise your user account from within Forma360.',
      ],
    },
    {
      heading: 'What gets deleted',
      body: [
        'On a verified request we delete or anonymise the personal data we hold about you, including your account profile, your AI assistant conversation history, and the link between your WhatsApp number and your Forma360 account so the assistant no longer recognises you.',
      ],
    },
    {
      heading: 'What we may retain',
      body: [
        'Operational records created within your organisation’s workspace (for example, an inspection you completed) may be retained by that organisation as its own records, with your identity removed or anonymised where appropriate. We may also keep limited information where the law requires it.',
      ],
    },
    {
      heading: 'Timeline',
      body: [
        'We acknowledge deletion requests promptly and complete verified deletions within 30 days. We will confirm by email when it is done.',
      ],
    },
    {
      heading: 'WhatsApp data',
      body: [
        'Messages you send on WhatsApp are also handled by Meta under its own policies. Deleting your data with us removes it from Forma360; to manage data held by WhatsApp itself, use the controls in your WhatsApp app or contact Meta.',
      ],
    },
  ],
};

export const ABOUT = {
  title: 'About Forma360',
  paragraphs: [
    `${COMPANY.name} is an operational-excellence platform that helps organisations run inspections, manage issues and corrective actions, track assets and maintenance, centralise documents, and understand performance through analytics — all with strict, multi-tenant data isolation.`,
    'Our built-in AI assistant lets teams ask questions about their operations in plain language and get instant, data-scoped answers — on the web and over WhatsApp, so people can check in from wherever they work.',
    `We are based at ${COMPANY.address}.`,
  ],
};

export const CONTACT = {
  title: 'Contact us',
  intro: 'We’d love to hear from you. Reach us using the details below.',
  items: [
    { label: 'General & support', value: COMPANY.email },
    { label: 'Privacy & data requests', value: COMPANY.privacyEmail },
    { label: 'Registered office', value: COMPANY.address },
    {
      label: 'Registered company',
      value: `${COMPANY.legalName} · Company No. ${COMPANY.companyNumber} · ${COMPANY.jurisdiction}`,
    },
    { label: 'Website', value: COMPANY.website },
  ],
};
