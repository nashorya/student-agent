export type SettingTarget = 'model' | 'embedding' | 'cancel';

export interface SettingTargetPrompt {
  menu: string;
  question: string;
}

export function buildSettingTargetPrompt(): SettingTargetPrompt {
  return {
    menu: [
      '设置项：',
      '  [1] 模型 Provider / API Key',
      '  [2] 向量模型',
      '  [q] 取消',
    ].join('\n'),
    question: '选择 [1]: ',
  };
}

export function parseSettingTargetAnswer(answer: string): SettingTarget {
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === 'q' || trimmed === 'quit' || trimmed === 'cancel') {
    return 'cancel';
  }
  if (trimmed === '2' || trimmed === 'embedding' || trimmed === 'vector' || trimmed === '向量模型') {
    return 'embedding';
  }
  return 'model';
}
