const steps: Record<string, string> = {
  chrome_browser: 'Working in Chrome…',
  create_word_document: 'Creating your Word document…', create_excel_workbook: 'Building your Excel workbook…', create_powerpoint: 'Preparing your PowerPoint slides…',
  inspect_office_file: 'Reading your Office file…', edit_office_file: 'Creating the revised file…', github_read: 'Reading GitHub…', collect_user_input: 'Waiting for your details…',
  analyze_csv: 'Analyzing the table…', calculate: 'Calculating…', thinking: 'Waiting for the model’s next response…',
};
export function generationStatus(step: string) { return steps[step] || 'Running the selected tool…'; }
