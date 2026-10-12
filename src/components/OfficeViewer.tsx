import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, ZoomIn, ZoomOut } from 'lucide-react';
import { renderAsync } from 'docx-preview';
import { officeFormat, officePackage, spreadsheetPreview } from '../lib/office-preview';

const NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const elements = (root: Element | Document, name: string) => Array.from(root.getElementsByTagNameNS(NS, name));
const hex = (value: string | null | undefined, fallback: string) => /^[\da-f]{6}$/i.test(value || '') ? `#${value}` : fallback;
function Slide({ xml, size }: { xml: string; size: [number, number] }) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const background = hex(doc.getElementsByTagName('p:bg')[0]?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val'), '#ffffff');
  const shapes = Array.from(doc.getElementsByTagName('p:sp'));
  return <svg className="office-slide" viewBox={`0 0 ${size[0]} ${size[1]}`} role="img" aria-label="PowerPoint slide preview">
    <rect width={size[0]} height={size[1]} fill={background} />
    {shapes.map((shape, index) => {
      const transform = elements(shape, 'xfrm')[0], off = transform && elements(transform, 'off')[0], ext = transform && elements(transform, 'ext')[0];
      if (!off || !ext) return null;
      const x = Number(off.getAttribute('x')) / 12700, y = Number(off.getAttribute('y')) / 12700, w = Number(ext.getAttribute('cx')) / 12700, h = Number(ext.getAttribute('cy')) / 12700;
      if (![x, y, w, h].every(Number.isFinite)) return null;
      const props = shape.getElementsByTagName('p:spPr')[0], fill = props && elements(props, 'solidFill')[0], fillColor = fill && elements(fill, 'srgbClr')[0]?.getAttribute('val');
      const paras = elements(shape, 'p'), geometry = props && elements(props, 'prstGeom')[0]?.getAttribute('prst');
      return <g key={index}>
        {fillColor && (geometry === 'ellipse' ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={hex(fillColor, 'transparent')} /> : <rect x={x} y={y} width={w} height={h} rx={geometry === 'roundRect' ? 10 : 0} fill={hex(fillColor, 'transparent')} />)}
        {!!paras.length && <foreignObject x={x} y={y} width={w} height={h}><div style={{ height: '100%', overflow: 'hidden', padding: '4px 6px', color: '#17212b' }}>{paras.map((p, i) => {
          const properties = elements(p, 'pPr')[0], rtl = properties?.getAttribute('rtl') === '1';
          return <div key={i} dir={rtl ? 'rtl' : 'ltr'} style={{ textAlign: properties?.getAttribute('algn') === 'r' ? 'right' : properties?.getAttribute('algn') === 'ctr' ? 'center' : 'left', marginBottom: 8, lineHeight: 1.2 }}>{elements(p, 'r').map((run, j) => {
            const rp = elements(run, 'rPr')[0], text = elements(run, 't')[0]?.textContent || '';
            return <span key={j} style={{ fontSize: Number(rp?.getAttribute('sz') || '1800') / 100, fontWeight: rp?.getAttribute('b') === '1' ? 700 : 400, fontFamily: elements(run, 'latin')[0]?.getAttribute('typeface') || 'Arial', color: hex(rp && elements(rp, 'srgbClr')[0]?.getAttribute('val'), '#17212b') }}>{text}</span>;
          })}</div>;
        })}</div></foreignObject>}
      </g>;
    })}
  </svg>;
}

export default function OfficeViewer({ dataUrl, title }: { dataUrl: string; title: string }) {
  const format = officeFormat(title), [error, setError] = useState(''), [loading, setLoading] = useState(true), [document, setDocument] = useState('');
  const [sheets, setSheets] = useState<Awaited<ReturnType<typeof spreadsheetPreview>>>([]), [slides, setSlides] = useState<string[]>([]), [size, setSize] = useState<[number, number]>([960, 540]);
  const [current, setCurrent] = useState(0), [zoom, setZoom] = useState(1), host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError(''); setCurrent(0);
    (async () => {
      const { bytes, zip } = await officePackage(dataUrl);
      if (format === 'docx') {
        const content = window.document.createElement('div'), styles = window.document.createElement('div');
        await renderAsync(await zip.generateAsync({ type: 'uint8array' }), content, styles, { className: 'nova-docx', useBase64URL: true, renderAltChunks: false, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true });
        content.querySelectorAll('a').forEach(link => link.removeAttribute('href'));
        if (!cancelled) setDocument(`${styles.innerHTML}${content.innerHTML}`);
      } else if (format === 'xlsx') { const value = await spreadsheetPreview(bytes); if (!cancelled) setSheets(value); }
      else if (format === 'pptx') {
        const paths = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (!paths.length || paths.length > 200) throw new Error('This presentation has no slides or exceeds 200 slides.');
        const presentation = await zip.file('ppt/presentation.xml')!.async('string');
        const parsed = new DOMParser().parseFromString(presentation, 'application/xml'), dimensions = parsed.getElementsByTagName('p:sldSz')[0];
        const value = await Promise.all(paths.map(path => zip.file(path)!.async('string')));
        if (!cancelled) { setSlides(value); setSize([Number(dimensions?.getAttribute('cx') || 12192000) / 12700, Number(dimensions?.getAttribute('cy') || 6858000) / 12700]); }
      } else throw new Error('Unsupported Office format.');
    })().catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not preview this file.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dataUrl, format]);
  if (loading) return <div className="office-empty" role="status"><LoaderCircle className="spin" />Preparing Office preview…</div>;
  if (error) return <div className="office-empty" role="alert">{error}<small>The original attachment is still available to download.</small></div>;
  const sheet = sheets[current];
  return <div className={`office-viewer office-${format}`} ref={host}>
    <div className="office-preview-controls">
      {format === 'xlsx' ? <div className="office-sheet-tabs">{sheets.map((sheet, index) => <button className={current === index ? 'active' : ''} key={sheet.name} onClick={() => setCurrent(index)}>{sheet.name}</button>)}</div> : format === 'pptx' ? <><button aria-label="Previous slide" disabled={!current} onClick={() => setCurrent(current - 1)}><ChevronLeft /></button><span>Slide {current + 1} / {slides.length}</span><button aria-label="Next slide" disabled={current === slides.length - 1} onClick={() => setCurrent(current + 1)}><ChevronRight /></button></> : <span>Document preview</span>}
      <button aria-label="Zoom out" onClick={() => setZoom(Math.max(.4, zoom - .1))}><ZoomOut /></button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="Zoom in" onClick={() => setZoom(Math.min(2, zoom + .1))}><ZoomIn /></button>
    </div>
    {format === 'docx' ? <iframe title={`Word preview: ${title}`} sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><style>body{margin:0;background:#e7e9ed;zoom:${zoom}}.nova-docx-wrapper{background:transparent!important;padding:24px!important}section.nova-docx{max-width:100%;box-sizing:border-box;box-shadow:0 6px 32px #0001!important}a{pointer-events:none}</style>${document}`} />
      : format === 'xlsx' ? <div className="office-sheet-scroll" style={{ fontSize: `${12 * zoom}px` }}>{sheet?.truncated && <p>Preview limited to 1,000 rows and 60 columns. Download for the complete workbook.</p>}<table><tbody>{sheet?.rows.map((row, index) => <tr key={index}><th>{index + 1}</th>{row.map(cell => <td key={cell.address} title={cell.address} dir="auto" style={{ fontWeight: cell.bold ? 700 : undefined, background: hex(cell.background, ''), color: hex(cell.color, ''), textAlign: cell.align === 'right' ? 'right' : cell.align === 'center' ? 'center' : undefined }}>{cell.text}</td>)}</tr>)}</tbody></table></div>
      : <div className="office-slide-scroll"><div style={{ width: `${zoom * 100}%`, minWidth: '40%' }}><Slide xml={slides[current]} size={size} /></div><small>Layout preview · complex charts, images, animations and inherited master styles may differ. Download to review in PowerPoint.</small></div>}
  </div>;
}
