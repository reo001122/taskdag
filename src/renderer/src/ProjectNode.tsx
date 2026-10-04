import { type NodeProps, NodeResizer } from '@xyflow/react';
import { useContext, useEffect, useRef, useState } from 'react';
import { PROJECT_COLORS } from './colors';
import { focusInput, NodeMeasured, useCloseOnOutsidePointerDown } from './node-editing';

/**
 * 枠の名前。Task 名と同じくワンクリックで改名に入る。
 *
 * フォーカスの扱いも Task 名と同じにしてある。blur を閉じる合図にすると、
 * 開いた直後に何かがフォーカスを奪うだけで畳まれ、2回クリックしないと
 * 編集に入れなくなる —— Task 名で実際に起きた。
 */
function ProjectName({
  name,
  onRename,
}: {
  name: string;
  onRename: (next: string) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const closingRef = useRef(false);

  const commitRef = useRef<() => void>(() => {});
  useEffect(() => {
    commitRef.current = (): void => {
      setEditing(false);
      const trimmed = draft.trim();
      if (trimmed.length > 0 && trimmed !== name) onRename(trimmed);
    };
  });

  const measured = useContext(NodeMeasured);
  useEffect(() => {
    if (!editing || !measured) return;
    closingRef.current = false;
    focusInput(inputRef.current, 'all');
  }, [editing, measured]);

  useCloseOnOutsidePointerDown(
    editing,
    (target) => inputRef.current?.contains(target) ?? false,
    () => {
      closingRef.current = true;
      commitRef.current();
    },
  );

  if (!editing) {
    /*
      ワンクリックで改名に入る。**枠はラベル以外でも掴めるようになったので、
      ラベルを取っ手として空けておく必要がなくなった。** Task 名と揃う。
    */
    return (
      <button
        type="button"
        className="project-name nodrag"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        title="クリックで改名"
      >
        {name}
      </button>
    );
  }

  return (
    <input
      className="text-input nodrag"
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!closingRef.current && document.hasFocus()) inputRef.current?.focus();
      }}
      onKeyDown={(e) => {
        // キャンバスのショートカットへ渡さない(bubble 側で止める。理由は EditableText)
        e.stopPropagation();

        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commitRef.current();
        }
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

export type ProjectNodeData = {
  id: string;
  name: string;
  /** 枠線と塗りに使う色。Task の左上の点と同じ色になる。 */
  color: string;
  colorIndex: number;
  onRecolor: (id: string, colorIndex: number) => void;
  onResizeEnd: (
    id: string,
    position: { x: number; y: number },
    width: number,
    height: number,
  ) => void;
  /**
   * 大きさを変えている最中の矩形。置けるかどうかの提示に使う(FR-4)。
   * 他の枠の位置を知っているのは App 側なので、判定はそちらに任せる。
   */
  onResizing: (id: string, rect: { x: number; y: number; width: number; height: number }) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

/**
 * Project の枠(FR-4)
 *
 * これはタグの見た目ではなく、領域そのもの。中に入っている Task が
 * この Project に属することになる。
 *
 * 枠はどこを掴んでも動く。中の Task は手前にいるので、Task の上から始めた
 * ドラッグは Task の移動になる —— 枠が持っていくことはない。
 */
export function ProjectFrameNode({ data, selected, width }: NodeProps): React.JSX.Element {
  const { id, name, color, colorIndex, onRecolor, onResizeEnd, onResizing, onRename, onDelete } =
    data as unknown as ProjectNodeData;
  const [pickingColor, setPickingColor] = useState(false);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLSpanElement>(null);

  // 色を選ばずに他所を押したときも閉じる。開いたままだと下の Task が隠れる。
  // 見本のボタン自身は「内側」に含める —— 含めないと、閉じた直後に
  // そのボタンの onClick がもう一度開いてしまう。
  useCloseOnOutsidePointerDown(
    pickingColor,
    (target) =>
      (swatchRef.current?.contains(target) ?? false) ||
      (pickerRef.current?.contains(target) ?? false),
    () => setPickingColor(false),
  );

  // Task と同じく、測り終えるまでは隠れている。
  const measured = width != null && width > 0;

  return (
    <NodeMeasured.Provider value={measured}>
      {/*
        大きさを変える取っ手は常に置いておく。選んでから掴む2手にすると、
        「掴めない」と受け取られる —— 取っ手が出ていないことが、選択されて
        いないせいだと分かるのは、仕組みを知っている側だけ。
        選んでいない間は薄く出し、ホバーで濃くする(styles.css)。
      */}
      <NodeResizer
        minWidth={140}
        minHeight={120}
        isVisible
        handleClassName={selected ? 'is-selected' : undefined}
        onResize={(_event, params) =>
          onResizing(id, { x: params.x, y: params.y, width: params.width, height: params.height })
        }
        onResizeEnd={(_event, params) =>
          onResizeEnd(id, { x: params.x, y: params.y }, params.width, params.height)
        }
      />
      <div
        className="project-frame"
        // 枠の色は Task の左上の点と揃える。どの枠に属しているかが、
        // 枠の中を見なくても点の色だけで分かるようにするため。
        style={{ '--project-color': color } as React.CSSProperties}
      >
        <span className="project-frame-label">
          <ProjectName name={name} onRename={(next) => onRename(id, next)} />

          <button
            type="button"
            ref={swatchRef}
            className="color-swatch nodrag"
            title="色を変える"
            onClick={() => setPickingColor((v) => !v)}
          />
          {pickingColor && (
            <span className="color-picker nodrag" ref={pickerRef}>
              {PROJECT_COLORS.map((swatch, index) => (
                <button
                  key={swatch}
                  type="button"
                  className={`color-option${index === colorIndex ? ' is-current' : ''}`}
                  style={{ background: swatch }}
                  title={`色 ${index + 1}`}
                  onClick={() => {
                    onRecolor(id, index);
                    setPickingColor(false);
                  }}
                />
              ))}
            </span>
          )}

          <button
            type="button"
            className="state-button nodrag"
            title="この Project を削除(中の Task は残る)"
            onClick={() => onDelete(id)}
          >
            ×
          </button>
        </span>
      </div>
    </NodeMeasured.Provider>
  );
}
