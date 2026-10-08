import type { Diagram as DiagramData } from './types';
export function Diagram({ diagram }: { diagram: DiagramData }) {
  return <svg viewBox={`0 0 ${diagram.width} ${diagram.height}`} role="img" aria-label={diagram.description} style={{ display: 'block', width: '100%', height: 'auto' }}>
    {diagram.marks.map((mark, i) => {
      switch (mark.kind) {
        case 'line': return <polyline key={i} points={mark.points.map(p => p.join(',')).join(' ')} fill="none" stroke={mark.color ?? '#17213d'} strokeWidth={mark.width ?? 2} strokeDasharray={mark.dash ? '5 5' : undefined} strokeLinejoin="round" strokeLinecap="round" />;
        case 'polygon': return <polygon key={i} points={mark.points.map(p => p.join(',')).join(' ')} fill={mark.fill ?? '#fffdf8'} stroke={mark.stroke ?? '#17213d'} strokeWidth="2" />;
        case 'rect': return <rect key={i} x={mark.x} y={mark.y} width={mark.width} height={mark.height} fill={mark.fill ?? '#fffdf8'} stroke={mark.stroke ?? '#17213d'} strokeWidth="2" />;
        case 'circle': return <circle key={i} cx={mark.x} cy={mark.y} r={mark.radius} fill={mark.fill ?? '#fffdf8'} stroke={mark.stroke ?? '#17213d'} strokeWidth="2" />;
        case 'text': return <text key={i} x={mark.x} y={mark.y} textAnchor="middle" dominantBaseline="middle" fontSize={mark.size ?? 20} fontWeight="650" fill={mark.color ?? '#17213d'}>{mark.text}</text>;
      }
    })}
  </svg>;
}
