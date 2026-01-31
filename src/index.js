export const OpenLinearSyncPlugin = async () => {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const note = `Open Linear Sync available. Use the CLI:
- open-linear-sync init (interactive Linear setup)
- open-linear-sync install (hooks + CI)
- open-linear-sync sync (manual sync)
`;

      (output.system ||= []).push(note);
    },
  };
};
