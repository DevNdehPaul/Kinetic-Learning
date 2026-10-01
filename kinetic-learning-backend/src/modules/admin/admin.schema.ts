import { z } from "zod";

const slug = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must use lowercase letters, numbers and hyphens");
const optionalText = z.string().trim().max(5000).nullable().optional();

export const programCreateSchema = z.object({
  title: z.string().trim().min(2).max(150), slug, description: optionalText,
  imageUrl: z.string().url().nullable().optional(), isPublished: z.boolean().optional(),
});
export const programUpdateSchema = programCreateSchema.partial();

export const courseCreateSchema = z.object({
  programId: z.string().uuid(), title: z.string().trim().min(2).max(150), slug,
  description: optionalText, position: z.number().int().min(0).optional(), isPublished: z.boolean().optional(),
});
export const courseUpdateSchema = courseCreateSchema.omit({ programId: true }).partial();

export const moduleCreateSchema = z.object({
  courseId: z.string().uuid(), title: z.string().trim().min(2).max(150), slug,
  description: optionalText, position: z.number().int().min(0).optional(), isPublished: z.boolean().optional(),
});
export const moduleUpdateSchema = moduleCreateSchema.omit({ courseId: true }).partial();

export const chapterCreateSchema = z.object({
  moduleId: z.string().uuid(), title: z.string().trim().min(2).max(150), slug,
  description: optionalText, content: z.string().nullable().optional(), position: z.number().int().min(0).optional(), isPublished: z.boolean().optional(),
});
export const chapterUpdateSchema = chapterCreateSchema.omit({ moduleId: true }).partial();
