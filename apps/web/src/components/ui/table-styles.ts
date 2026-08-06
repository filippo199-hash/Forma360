/**
 * Shared table styling constants.
 *
 * The Inspections list page is the platform reference (ADR 0014). Its table
 * header is `border-b bg-muted/40 text-left` with `px-3 py-2 font-medium`
 * cells; every module list table matches it so headers do not drift (some
 * modules had shipped `bg-muted/50` uppercase, no fill, or `text-xs` muted
 * variants). Import these instead of re-typing the classes.
 *
 * The table itself lives inside the standard frame:
 *   <Card className="hidden md:block">
 *     <CardContent className="p-0">
 *       <div className="overflow-x-auto">
 *         <table className="w-full text-sm"> … </table>
 */

/** `<thead>` (or its `<tr>`) className. */
export const TABLE_THEAD_CLASS = 'border-b bg-muted/40 text-left';

/** Header cell className for a labelled `<th>`. */
export const TABLE_TH_CLASS = 'px-3 py-2 font-medium';

/** Body row className — bottom border, no border on the last row, hover tint. */
export const TABLE_ROW_CLASS = 'border-b last:border-0 hover:bg-muted/10';

/** Body cell className. */
export const TABLE_TD_CLASS = 'px-3 py-3';
