interface BufferedPromptLogOptions {
  writeLog: (message: string) => void;
  prompt: (question: string) => Promise<string>;
}

export interface BufferedPromptLog {
  log: (message: string) => void;
  prompt: (question: string) => Promise<string>;
}

export function createBufferedPromptLog(options: BufferedPromptLogOptions): BufferedPromptLog {
  let pendingLog = '';

  const flush = () => {
    const message = pendingLog.trimEnd();
    pendingLog = '';
    if (message.trim()) {
      options.writeLog(message);
    }
  };

  return {
    log(message: string) {
      pendingLog += message + '\n';
    },
    async prompt(question: string) {
      flush();
      return options.prompt(question);
    },
  };
}
