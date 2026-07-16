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

  it('解析 abort 命令及别名', () => {
    expect(parseCommand('/abort')).toEqual({ type: 'abort' });
    expect(parseCommand('/stop')).toEqual({ type: 'abort' });
    expect(parseCommand('/cancel')).toEqual({ type: 'abort' });
  });

  it('解析 setting 命令及别名', () => {
    expect(parseCommand('/setting')).toEqual({ type: 'setting' });
    expect(parseCommand('/settings')).toEqual({ type: 'setting' });
  });

  it('解析 provider 命令', () => {
    expect(parseCommand('/provider')).toEqual({ type: 'provider' });
    expect(COMMAND_COMPLETIONS).toContain('/provider');
    expect(getHelpText()).toContain('/provider');
  });

  it('解析 clear 命令', () => {
    expect(parseCommand('/clear')).toEqual({ type: 'clear' });
  });

  it('解析 candidates 命令', () => {
    expect(parseCommand('/candidates')).toEqual({ type: 'candidates' });
  });

  it('解析 context 命令', () => {
    expect(parseCommand('/context')).toEqual({ type: 'context' });
  });

  it('解析单次提交的 /paste 多行块', () => {
    expect(parseCommand('/paste\n第一行\n第二行\n/end')).toEqual({
      type: 'paste',
      content: '第一行\n第二行',
    });
    expect(parseCommand('/paste 第一行\n第二行\n/end')).toEqual({
      type: 'paste',
      content: '第一行\n第二行',
    });
  });

  it('/paste 缺少 /end 返回 unknown', () => {
    expect(parseCommand('/paste\n第一行')).toEqual({
      type: 'unknown',
      raw: '/paste\n第一行',
    });
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
    expect(parseCommand('/task cancel')).toEqual({
      type: 'task',
      subcommand: 'cancel',
    });
    expect(parseCommand('/task clear')).toEqual({
      type: 'task',
      subcommand: 'cancel',
    });
  });

  it('parses archive commands', () => {
    expect(parseCommand('/archive status')).toEqual({ type: 'archive', subcommand: 'status' });
    expect(parseCommand('/archive adr new Adapter architecture')).toEqual({ type: 'archive', subcommand: 'adr-new', title: 'Adapter architecture' });
    expect(parseCommand('/archive bug open Binary Markdown')).toEqual({ type: 'archive', subcommand: 'bug-open', title: 'Binary Markdown' });
    expect(parseCommand('/archive bug update BUG-012 FIXED')).toEqual({ type: 'archive', subcommand: 'bug-update', id: 'BUG-012', status: 'FIXED' });
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
    expect(help).toContain('/abort');
    expect(help).toContain('/setting');
    expect(help).toContain('/clear');
    expect(help).toContain('/candidates');
    expect(help).toContain('/context');
    expect(help).toContain('/feedback');
    expect(help).toContain('/review');
    expect(help).toContain('/why');
    expect(help).toContain('/plan');
    expect(help).toContain('/task');
    expect(help).toContain('/task cancel');
    expect(help).toContain('/archive');
  });
});

describe('COMMAND_COMPLETIONS', () => {
  it('包含常用子命令补全', () => {
    expect(COMMAND_COMPLETIONS).toContain('/plan revision ');
    expect(COMMAND_COMPLETIONS).toContain('/feedback down ');
    expect(COMMAND_COMPLETIONS).toContain('/context');
    expect(COMMAND_COMPLETIONS).toContain('/archive build');
  });
});
