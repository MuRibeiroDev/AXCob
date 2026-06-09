import { SetMetadata } from '@nestjs/common';

/** Marca uma rota como pública (sem exigir token). */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
