import { z } from 'zod';
import type { Zone } from './world.js';

/** Temporary visual overlays. These are deliberately separate from appearance assets. */
export const ATTACHMENTS = {
  punch: { name: '潘趣酒', path: '/attachments/punch.png' },
  cookie: { name: '饼干', path: '/attachments/cookie.png' },
  grape: { name: '葡萄', path: '/attachments/grape.png' },
  guava: { name: '芭乐', path: '/attachments/guava.png' },
  cheese: { name: '芝士', path: '/attachments/cheese.png' },
  ham: { name: '火腿片', path: '/attachments/ham.png' },
  'party-crown': { name: '派对皇冠', path: '/attachments/party-crown.png' },
} as const;
export type AttachmentId = keyof typeof ATTACHMENTS;
export const attachmentIdSchema = z.enum(Object.keys(ATTACHMENTS) as [AttachmentId, ...AttachmentId[]]);
export const attachmentModeSchema = z.enum(['single-unlimited', 'single-unique', 'multiple-unlimited-random']);
export const attachmentSourcePropertiesSchema = z.object({
  mode: attachmentModeSchema,
  attachmentIds: z.string().transform(value => value.split(',').map(id => id.trim()))
    .pipe(z.array(attachmentIdSchema).min(1).refine(ids => new Set(ids).size === ids.length, 'Attachment IDs must be distinct')),
  visualObjectId: z.number().int().positive().optional(),
  visualGid: z.number().int().positive().optional(),
  visualX: z.number().finite().nonnegative().optional(),
  visualY: z.number().finite().nonnegative().optional(),
}).superRefine((source, ctx) => {
  if (source.mode !== 'multiple-unlimited-random' && source.attachmentIds.length !== 1)
    ctx.addIssue({ code: 'custom', message: 'Single attachment sources require exactly one attachment' });
  if (source.mode === 'multiple-unlimited-random' && source.attachmentIds.length < 2)
    ctx.addIssue({ code: 'custom', message: 'Random attachment sources require multiple attachments' });
  const visualFields = [source.visualGid, source.visualX, source.visualY];
  if (visualFields.some(value => value !== undefined) && visualFields.some(value => value === undefined))
    ctx.addIssue({ code: 'custom', message: 'Source visuals require visualGid, visualX and visualY together' });
  if (source.visualObjectId === undefined && (source.visualX !== undefined && source.visualX % 16 !== 0 || source.visualY !== undefined && source.visualY % 16 !== 0))
    ctx.addIssue({ code: 'custom', message: 'Source visual positions must align to the tile grid' });
});
export type AttachmentSourceProperties = z.output<typeof attachmentSourcePropertiesSchema>;
export const takeAttachmentSchema = z.object({ sourceId: z.string().trim().min(1).max(128) }).strict();
export type TakeAttachmentInput = z.infer<typeof takeAttachmentSchema>;
/** JSON tuple keeps map and authored source IDs unambiguous. */
export function attachmentSourceKey(mapId: string, sourceId: string) { return JSON.stringify([mapId, sourceId]); }
export function attachmentSource(zone: Zone): AttachmentSourceProperties {
  return attachmentSourcePropertiesSchema.parse(zone.properties);
}
