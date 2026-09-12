import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react';
import { useState } from 'react';

/**
 * 依存エッジ(FR-3)
 *
 * 線の上に、その線を外すための × を置く。 選んで Delete でも消せたが、その道は
 * Task の削除と共用で、削除前に何が起きるかを見せる約束(FR-1)を迂回してしまう。
 * 外したい線そのものを狙える場所を、線の上に用意する。
 */
export type DependencyEdgeData = {
  onRemove: (id: string) => void;
};

export function DependencyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps): React.JSX.Element {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const [hovered, setHovered] = useState(false);
  const { onRemove } = data as unknown as DependencyEdgeData;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />

      {/* 線は細い。狙えるようにするため、当たり判定だけを太くした透明な線を重ねる。 */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: ホバーは × を早く見せる
          ための補助にすぎない。キーボードからは × 自体に Tab で辿り着け、
          そのとき :focus-visible で見えるようにしてある(styles.css)。 */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      <EdgeLabelRenderer>
        {/*
          消えている間もポインタは受け続ける。見えなくなった瞬間に掴めなくなると、
          線から × へカーソルを移す途中で消えて押せない。
        */}
        <button
          type="button"
          className={`edge-remove nodrag nopan${hovered ? ' is-shown' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => onRemove(id)}
          title="この依存を外す"
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
