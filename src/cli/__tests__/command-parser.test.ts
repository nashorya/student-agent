import { describe, it, expect } from 'vitest';
import { COMMAND_COMPLETIONS, parseCommand, getHelpText } from '../command-parser.js';

describe('parseCommand', () => {
  it('非 / 开头返回 null', () => {
    expect(parseCommand('hello world')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('  spaces  ')).toBeNull();
  });

  it('解析 quit 命令及别名', () => {
    expect(parseCommand('/quit')).toEqual({ type: 'quit' });
    expect(parseCommand('/exit')).toEqual({ type: 'quit' });
    expect(parseCommand('/q')).toEqual({ type: 'quit' });
    expect(parseCommand('  /quit  ')).toEqual({ type: 'quit' });
  });

  it('解析 help 命令及别名', () => {
    expect(parseCommand('/help')).toEqual({ type: 'help' });
    expect(parseCommand('/h')).toEqual({ type: 'help' });
    expect(parseCommand('/?')).toEqual({ type: 'help' });
  });

  it('解析 status 命令', () => {
    expect(parseCommand('/status')).toEqual({ type: 'status' });
  });

  it('解析 setting 命令及别名', () => {
    expect(parseCommand('/setting')).toEqual({ type: 'setting' });
    expect(parseCommand('/settings')).toEqual({ type: 'setting' });
  });

  it('解析 clear 命令', () => {
    expect(parseCommand('/clear')).toEqual({ type: 'clear' });
  });

  it('解析 candidates 命令', () => {
    expect(parseCommand('/candidates')).toEqual({ type: 'candidates' });
  });

  it('解析 feedback 命令', () => {
    expect(parseCommand('/feedback up 很好')).toEqual({
      type: 'feedback',
      rating: 'up',
      comment: '很好',
    });
    expect(parseCommand('/feedback down 不太对')).toEqual({
      type: 'feedback',
      rating: 'down',
      comment: '不太对',
    });
    expect(parseCommand('/feedback up')).toEqual({
      type: 'feedback',
      rating: 'up',
      comment: '',
    });
  });

  it('解析 review 和 why 命令', () => {
    expect(parseCommand('/review ok 稳定')).toEqual({
      type: 'review',
      rating: 'ok',
      comment: '稳定',
    });
    expect(parseCommand('/why breaker --trace')).toEqual({
      type: 'why',
      query: 'breaker',
      trace: true,
    });
  });

  it('解析 plan revision 命令', () => {
    expect(parseCommand('/plan revision 先做低风险修复')).toEqual({
      type: 'plan',
      subcommand: 'revision',
      content: '先做低风险修复',
    });
    expect(parseCommand('/plan revisions TUI')).toEqual({
      type: 'plan',
      subcommand: 'revisions',
      query: 'TUI',
    });
    expect(parseCommand('/plan revisions')).toEqual({
      type: 'plan',
      subcommand: 'revisions',
      query: '',
    });
  });

  it('feedback 缺少 rating 返回 unknown', () => {
    expect(parseCommand('/feedback')).toEqual({
      type: 'unknown',
      raw: '/feedback',
    });
    expect(parseCommand('/feedback maybe')).toEqual({
      type: 'unknown',
      raw: '/feedback maybe',
    });
  });

  it('解析 task 命令', () => {
    expect(parseCommand('/task')).toEqual({
      type: 'task',
      subcommand: 'status',
    });
    expect(parseCommand('/task status')).toEqual({
      type: 'task',
      subcommand: 'status',
    });
    expect(parseCommand('/task rename 新任务名')).toEqual({
      type: 'task',
      subcommand: 'rename',
      name: '新任务名',
    });
    expect(parseCommand('/task rename 多个 词 的 名字')).toEqual({
      type: 'task',
      subcommand: 'rename',
      name: '多个 词 的 名字',
    });
  });

  it('解析 design 命令', () => {
    expect(parseCommand('/design study https://example.com --name Food App')).toEqual({
      type: 'design',
      subcommand: 'study',
      url: 'https://example.com',
      name: 'Food App',
    });
    expect(parseCommand('/design confirm design_cand_1')).toEqual({
      type: 'design',
      subcommand: 'confirm',
      candidateId: 'design_cand_1',
    });
    expect(parseCommand('/design use food-app')).toEqual({
      type: 'design',
      subcommand: 'use',
      profileId: 'food-app',
    });
    expect(parseCommand('/design local-url http://localhost:3000')).toEqual({
      type: 'design',
      subcommand: 'local-url',
      url: 'http://localhost:3000',
    });
    expect(parseCommand('/design critique http://localhost:3000 food-app')).toEqual({
      type: 'design',
      subcommand: 'critique',
      url: 'http://localhost:3000',
      profileId: 'food-app',
    });
  });

  it('design 缺少必要参数返回 unknown', () => {
    expect(parseCommand('/design study')).toEqual({
      type: 'unknown',
      raw: '/design study',
    });
    expect(parseCommand('/design confirm')).toEqual({
      type: 'unknown',
      raw: '/design confirm',
    });
  });

  it('未知命令返回 unknown', () => {
    expect(parseCommand('/foo')).toEqual({ type: 'unknown', raw: '/foo' });
    expect(parseCommand('/bar baz')).toEqual({ type: 'unknown', raw: '/bar baz' });
  });

  it('命令大小写不敏感', () => {
    expect(parseCommand('/QUIT')).toEqual({ type: 'quit' });
    expect(parseCommand('/Help')).toEqual({ type: 'help' });
    expect(parseCommand('/STATUS')).toEqual({ type: 'status' });
  });
});

describe('getHelpText', () => {
  it('包含所有命令', () => {
    const help = getHelpText();
    expect(help).toContain('/help');
    expect(help).toContain('/quit');
    expect(help).toContain('/status');
    expect(help).toContain('/setting');
    expect(help).toContain('/clear');
    expect(help).toContain('/candidates');
    expect(help).toContain('/feedback');
    expect(help).toContain('/review');
    expect(help).toContain('/why');
    expect(help).toContain('/plan');
    expect(help).toContain('/task');
    expect(help).toContain('/design');
  });
});

describe('COMMAND_COMPLETIONS', () => {
  it('包含常用子命令补全', () => {
    expect(COMMAND_COMPLETIONS).toContain('/design study ');
    expect(COMMAND_COMPLETIONS).toContain('/design confirm ');
    expect(COMMAND_COMPLETIONS).toContain('/plan revision ');
    expect(COMMAND_COMPLETIONS).toContain('/feedback down ');
  });
});
