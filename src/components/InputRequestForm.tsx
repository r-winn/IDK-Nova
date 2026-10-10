import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import type { InputSession } from '../lib/input-requests';

export function InputRequestForm({ session }: { session: InputSession }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [step]);
  const question = session.questions[step], value = answers[question.id] || '';
  const last = step === session.questions.length - 1;
  const update = (answer: string) => { setAnswers(current => ({ ...current, [question.id]: answer })); setError(''); };
  return <form className="input-request-form" aria-label="Provide requested details" onSubmit={event => {
    event.preventDefault();
    if (!value.trim()) return;
    if (!last) { setStep(step + 1); return; }
    try { session.submit(answers); } catch (error) { setError(error instanceof Error ? error.message : 'Check your answers.'); }
  }}>
    <header><span><b dir="auto">{session.title}</b><small>Step {step + 1} of {session.questions.length} · Waiting for your input</small></span><button type="button" aria-label="Cancel input request" onClick={session.cancel}><X /></button></header>
    <div className="input-step-track" aria-hidden="true">{session.questions.map((item, index) => <i key={item.id} className={index <= step ? 'complete' : ''} />)}</div>
    <section key={question.id} className="input-question-step">
      <label htmlFor={`input-${question.id}`} dir="auto">{question.question}</label>
      {!!question.options.length && <div className="input-question-options">{question.options.map(option => <button type="button" aria-pressed={value === option} className={value === option ? 'selected' : ''} key={option} onClick={() => update(option)}><span dir="auto">{option}</span>{value === option && <Check />}</button>)}</div>}
      <textarea ref={input} id={`input-${question.id}`} dir="auto" rows={2} maxLength={12000} value={value} placeholder={question.options.length ? 'Choose an option or type your own answer…' : 'Your answer…'} onChange={event => update(event.target.value)} onKeyDown={event => {
        if (!event.nativeEvent.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
      }} />
    </section>
    {error && <p role="alert">{error}</p>}
    <footer><small>Answers go to the selected model. Do not enter passwords or API keys.</small><div><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft />Back</button><button type="submit" className="primary" disabled={!value.trim()}>{last ? 'Continue task' : 'Next'}{last ? <Check /> : <ArrowRight />}</button></div></footer>
  </form>;
}
