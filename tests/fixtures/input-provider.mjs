// Local-only provider fixture for manual inline-form UI checks. No real keys.
import { createServer } from 'node:http';
const form = { title: 'اطلاعات ایمیل', questions: [
  { id: 'recipient', question: 'این ایمیل برای چه کسی است؟', options: [] },
  { id: 'purpose', question: 'هدف ایمیل چیست؟', options: ['خوش‌آمدگویی', 'پیگیری', 'درخواست جلسه', 'تشکر'] },
  { id: 'language', question: 'زبان ایمیل را انتخاب کنید', options: ['English', 'فارسی'] },
  { id: 'tone', question: 'لحن ایمیل چطور باشد؟', options: ['رسمی', 'دوستانه', 'کوتاه', 'صمیمی'] },
] };
let sequence = 0;
createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:1434');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'nova-test' }] })); return; }
  if (req.method !== 'POST') { res.statusCode = 404; res.end('{}'); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (req.url === '/v1/responses') {
    const result = body.input?.find(item => item.type === 'function_call_output');
    if (result) {
      const answers = JSON.parse(result.output).answers;
      res.end(JSON.stringify({ id: `r${++sequence}`, output_text: `Subject: Welcome\n\nHello ${answers?.[0]?.answer || 'Sam'}, welcome to the team!\n\nCollected ${answers?.length || 0} answers and resumed the same task.`, output: [] }));
    } else {
      res.end(JSON.stringify({ id: `r${++sequence}`, output: [{ type: 'function_call', name: 'collect_user_input', call_id: `input${sequence}`, arguments: JSON.stringify(form) }] }));
    }
    return;
  }
  res.statusCode = 404; res.end('{}');
}).listen(1435, '127.0.0.1', () => console.log('Local form fixture on 127.0.0.1:1435'));
