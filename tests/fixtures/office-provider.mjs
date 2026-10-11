// Test-only provider, bound to loopback. Never accepts real provider keys.
import http from 'node:http';
let sequence = 0;
const server = http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'nova-test' }] })); return; }
  if (request.url !== '/v1/chat/completions') { response.writeHead(404); response.end('{}'); return; }
  let body = ''; for await (const chunk of request) body += chunk;
  if (/data:[^"\s]*;base64,/.test(body)) { response.writeHead(400); response.end('Binary file leaked into provider body'); return; }
  const payload = JSON.parse(body), messages = payload.messages;
  const latest = messages.findLast(message => message.role === 'user')?.content || '';
  const toolMessages = messages.filter(message => message.role === 'tool');
  const last = toolMessages.at(-1); let message;
  if (String(latest).includes('@create_powerpoint')) {
    message = !last ? call('create_powerpoint', { filename: 'ui-slides', title: 'Nova UI test', rtl: true, theme: { accent: '245B7A' }, slides: [{ title: 'اسلاید آزمایشی', bullets: ['متن فارسی', 'Editable presentation'], notes: 'Actual speaker notes' }] }) : { role: 'assistant', content: 'Actual PowerPoint slides attached.' };
  } else if (String(latest).includes('@edit_office_file')) {
    if (!last) message = call('inspect_office_file', { source: 'ui-report.docx' });
    else if (last.name === 'inspect_office_file' || JSON.parse(last.content).entries) {
      const entry = JSON.parse(last.content).entries.find(entry => entry.text === 'Original content');
      message = call('edit_office_file', { source: 'ui-report.docx', filename: 'ui-report-revised.docx', edits: [{ id: entry.id, expected: entry.text, value: 'Revised content' }] });
    } else message = { role: 'assistant', content: 'Revised Office file attached. Original kept.' };
  } else if (!last) message = call('create_word_document', { filename: 'ui-report', title: 'Office UI test', paragraphs: [], rtl: false, layout: { header: 'Nova test', fontSize: 12 }, blocks: [{ type: 'paragraph', text: 'Original content' }, { type: 'table', rows: [['Item', 'Value'], ['Sample', '42']] }] });
  else message = { role: 'assistant', content: 'Your actual styled Word file is attached.' };
  if (!last) await new Promise(resolve => setTimeout(resolve, 1800));
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
});
function call(name, args) { return { role: 'assistant', content: '', tool_calls: [{ id: `fixture-${++sequence}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }; }
server.listen(1435, '127.0.0.1', () => process.stdout.write('Office fixture ready on 127.0.0.1:1435\n'));
