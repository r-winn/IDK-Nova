import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, ZoomIn, ZoomOut } from 'lucide-react';
import { renderAsync } from 'docx-preview';
import { officeFormat, officePackage, spreadsheetPreview } from '../lib/office-preview';

const NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const elements = (root: Element | Document, name: string) => Array.from(root.getElementsByTagNameNS(NS, name));
const hex = (value: string | null | undefined, fallback: string) => /^[\da-f]{6}$/i.test(value || '') ? `#${value}` : fallback;
type SlideData = { xml: string; charts: Record<string, string>; images: Record<string, string> };
const frameBounds = (root: Element) => {
  const off = elements(root, 'off')[0], ext = elements(root, 'ext')[0];
  const values = [off?.getAttribute('x'), off?.getAttribute('y'), ext?.getAttribute('cx'), ext?.getAttribute('cy')].map(value => Number(value) / 12700);
  return off && ext && values.every(Number.isFinite) ? values : null;
};
function ChartPreview({ xml, x, y, w, h }: { xml: string; x: number; y: number; w: number; h: number }) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const series = Array.from(doc.getElementsByTagName('c:ser')).slice(0, 4).map(ser => ({
    labels: Array.from(ser.getElementsByTagName('c:cat')[0]?.getElementsByTagName('c:pt') || []).slice(0, 12).map(pt => pt.getElementsByTagName('c:v')[0]?.textContent || ''),
    values: Array.from(ser.getElementsByTagName('c:val')[0]?.getElementsByTagName('c:pt') || []).slice(0, 12).map(pt => Number(pt.getElementsByTagName('c:v')[0]?.textContent)),
  }));
  if (!series.length || series.some(ser => ser.values.some(value => !Number.isFinite(value)))) return null;
  const labels = series[0].labels, min = Math.min(0, ...series.flatMap(ser => ser.values)), max = Math.max(1, ...series.flatMap(ser => ser.values));
  const plotH = h - 40, plotW = w - 44, left = 35, top = 8, position = (value: number) => top + (max - value) / (max - min) * plotH;
  const colors = ['#5084c4', '#8399b3', '#c8a475', '#679c87'];
  const circular = !!doc.getElementsByTagName('c:pieChart').length || !!doc.getElementsByTagName('c:doughnutChart').length;
  const line = !!doc.getElementsByTagName('c:lineChart').length;
  const foreground = hex(doc.getElementsByTagName('c:catAx')[0]?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val'), '#64748b');
  if (circular) {
    const values = series[0].values, total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0 || values.some(value => value < 0)) return null;
    let angle = -Math.PI / 2;
    const radius = Math.min(w * .28, h * .42), cx = w * .35, cy = h / 2;
    return <svg x={x} y={y} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {values.map((value, i) => { const start = angle; angle += value / total * Math.PI * 2; const d = value === total ? null : `M ${cx} ${cy} L ${cx + radius * Math.cos(start)} ${cy + radius * Math.sin(start)} A ${radius} ${radius} 0 ${value / total > .5 ? 1 : 0} 1 ${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)} Z`; return d ? <path key={i} d={d} fill={colors[i % colors.length]} /> : <circle key={i} cx={cx} cy={cy} r={radius} fill={colors[i % colors.length]} />; })}
      {labels.map((label, i) => <text key={i} x={w * .7} y={25 + i * 22} fill={foreground} fontSize={12}>{label}: {values[i]}</text>)}
    </svg>;
  }
  const step = plotW / Math.max(1, labels.length);
  return <svg x={x} y={y} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
    <line x1={left} x2={left + plotW} y1={position(0)} y2={position(0)} stroke={foreground} opacity={.4} />
    {series.map((ser, s) => <g key={s}>{line ? <polyline points={ser.values.map((value, i) => `${left + step * (i + .5)},${position(value)}`).join(' ')} fill="none" stroke={colors[s]} strokeWidth={2} /> : ser.values.map((value, i) => <rect key={i} x={left + step * i + step * .1 + s * step * .8 / series.length} y={Math.min(position(value), position(0))} width={step * .8 / series.length} height={Math.abs(position(value) - position(0))} fill={colors[s]} />)}
      {ser.values.map((value, i) => <text key={i} x={left + step * (i + .5)} y={position(value) - 5} fontSize={11} fill={foreground} textAnchor="middle">{value}</text>)}
    </g>)}
    {labels.map((label, i) => <text key={i} x={left + step * (i + .5)} y={h - 10} fontSize={12} fill={foreground} textAnchor="middle">{label}</text>)}
  </svg>;
}
function Slide({ data, size }: { data: SlideData; size: [number, number] }) {
  const { xml } = data;
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
    {Array.from(doc.getElementsByTagName('p:pic')).map((picture, index) => {
      const bounds = frameBounds(picture), id = elements(picture, 'blip')[0]?.getAttribute('r:embed');
      return bounds && id && data.images[id] ? <image key={`image-${index}`} x={bounds[0]} y={bounds[1]} width={bounds[2]} height={bounds[3]} href={data.images[id]} preserveAspectRatio="xMidYMid meet" /> : null;
    })}
    {Array.from(doc.getElementsByTagName('p:graphicFrame')).map((frame, index) => {
      const bounds = frameBounds(frame);
      if (!bounds) return null;
      const [x, y, w, h] = bounds, chartId = frame.getElementsByTagName('c:chart')[0]?.getAttribute('r:id');
      if (chartId && data.charts[chartId]) return <ChartPreview key={`chart-${index}`} xml={data.charts[chartId]} x={x} y={y} w={w} h={h} />;
      const rows = elements(frame, 'tr');
      return rows.length ? <foreignObject key={`table-${index}`} x={x} y={y} width={w} height={h}><table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', fontSize: 15 }}>{rows.map((row, i) => <tbody key={i}><tr>{elements(row, 'tc').map((cell, j) => {
        const props = elements(cell, 'tcPr')[0], fill = props && elements(props, 'solidFill')[0];
        const ink = elements(cell, 'rPr')[0];
        return <td key={j} style={{ padding: 8, background: hex(fill && elements(fill, 'srgbClr')[0]?.getAttribute('val'), i ? '#f1f5f9' : '#245b7a'), color: hex(ink && elements(ink, 'srgbClr')[0]?.getAttribute('val'), i ? '#17212b' : '#ffffff'), fontWeight: i ? 400 : 700 }}>{elements(cell, 't').map(t => t.textContent).join(' ')}</td>;
      })}</tr></tbody>)}</table></foreignObject> : null;
    })}
  </svg>;
}

export default function OfficeViewer({ dataUrl, title }: { dataUrl: string; title: string }) {
  const format = officeFormat(title), [error, setError] = useState(''), [loading, setLoading] = useState(true), [document, setDocument] = useState('');
  const [sheets, setSheets] = useState<Awaited<ReturnType<typeof spreadsheetPreview>>>([]), [slides, setSlides] = useState<SlideData[]>([]), [size, setSize] = useState<[number, number]>([960, 540]);
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
        const value = await Promise.all(paths.map(async path => {
          const data: SlideData = { xml: await zip.file(path)!.async('string'), charts: {}, images: {} };
          const rels = await zip.file(path.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels')?.async('string');
          if (rels) for (const rel of Array.from(new DOMParser().parseFromString(rels, 'application/xml').getElementsByTagName('Relationship'))) {
            const id = rel.getAttribute('Id'), target = rel.getAttribute('Target');
            if (!id || !target || rel.getAttribute('TargetMode') === 'External') continue;
            const parts = ['ppt', 'slides'];
            for (const part of target.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
            const resolved = parts.join('/'), file = zip.file(resolved);
            if (!file) continue;
            if (/^ppt\/charts\/chart\d+\.xml$/.test(resolved)) data.charts[id] = await file.async('string');
            else if (/^ppt\/media\/[\w.-]+\.(png|jpe?g)$/i.test(resolved)) data.images[id] = `data:image/${/\.png$/i.test(resolved) ? 'png' : 'jpeg'};base64,${await file.async('base64')}`;
          }
          return data;
        }));
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
      {format === 'xlsx' ? <div className="office-sheet-tabs">{sheets.map((sheet, index) => <button className={current === index ? 'active' : ''} key={sheet.name} onClick={() => setCurrent(index)}>{sheet.name}</button>)}</div> : format === 'pptx' ? <div className="office-page-nav"><button title="Previous slide" aria-label="Previous slide" disabled={!current} onClick={() => setCurrent(current - 1)}><ChevronLeft /></button><span>{current + 1} / {slides.length}</span><button title="Next slide" aria-label="Next slide" disabled={current === slides.length - 1} onClick={() => setCurrent(current + 1)}><ChevronRight /></button></div> : <span>Document preview</span>}
      <div className="office-zoom-group"><button title="Zoom out" aria-label="Zoom out" onClick={() => setZoom(Math.max(.4, zoom - .1))}><ZoomOut /></button><button title="Reset zoom" aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button title="Zoom in" aria-label="Zoom in" onClick={() => setZoom(Math.min(2, zoom + .1))}><ZoomIn /></button></div>
    </div>
    {format === 'docx' ? <iframe title={`Word preview: ${title}`} sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><style>body{margin:0;background:#e7e9ed;zoom:${zoom}}.nova-docx-wrapper{background:transparent!important;padding:24px!important}section.nova-docx{max-width:100%;box-sizing:border-box;box-shadow:0 6px 32px #0001!important}a{pointer-events:none}</style>${document}`} />
      : format === 'xlsx' ? <div className="office-sheet-scroll" style={{ fontSize: `${12 * zoom}px` }}>{sheet?.truncated && <p>Preview limited to 1,000 rows and 60 columns. Download for the complete workbook.</p>}<table><tbody>{sheet?.rows.map((row, index) => <tr key={index}><th>{index + 1}</th>{row.map(cell => <td key={cell.address} title={cell.address} dir="auto" style={{ fontWeight: cell.bold ? 700 : undefined, background: hex(cell.background, ''), color: hex(cell.color, ''), textAlign: cell.align === 'right' ? 'right' : cell.align === 'center' ? 'center' : undefined }}>{cell.text}</td>)}</tr>)}</tbody></table></div>
      : <div className="office-slide-scroll"><div style={{ width: `${zoom * 100}%`, minWidth: '40%' }}>{slides[current] && <Slide data={slides[current]} size={size} />}</div><small>Approximate preview · supported charts, tables and embedded PNG/JPEG images are shown. Complex chart styles, animations and inherited masters may differ. Download to review in PowerPoint.</small></div>}
  </div>;
}
