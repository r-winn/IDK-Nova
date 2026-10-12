// Lightweight metadata helper: ordinary chats never load the Office libraries.
export const officeFormat = (name: string) => /\.(docx|xlsx|pptx)$/i.exec(name)?.[1].toLowerCase() || '';
