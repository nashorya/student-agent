import { describe, it, expect } from 'vitest';
import { parseCommand, getHelpText } from '../command-parser.js';

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
    expect(help).toContain('/clear');
    expect(help).toContain('/candidates');
    expect(help).toContain('/feedback');
  });
});
