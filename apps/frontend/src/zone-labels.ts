import type { Zone } from '@virtual-workspace/shared';

export const zoneLabels: Record<Zone['kind'], string> = {
  board: '留言板', pomodoro: '番茄钟', media: '同步观看',
  whiteboard: '白板', drawing: '共同作画', document: '协作文档',
};
