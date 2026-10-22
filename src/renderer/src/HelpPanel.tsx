import { Panel } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { INPUT_SHORTCUTS, SHORTCUTS } from './keymap';

/**
 * キー操作の一覧(カンペ)。中身は keymap.ts の SHORTCUTS / INPUT_SHORTCUTS から作る。
 *
 * 修飾キーの表記(Mac の ⌘ / ⇧ か、Ctrl / Shift か)は表示の都合なので、keymap.ts ではなく
 * ここで決める。
 */

function isMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac/i.test(platform);
}

function label(token: string, mac: boolean): string {
  if (token === 'Mod') return mac ? '⌘' : 'Ctrl';
  if (token === 'Shift') return mac ? '⇧' : 'Shift';
  return token;
}

function Keys({
  keys,
  mac,
}: {
  keys: readonly (readonly string[])[];
  mac: boolean;
}): React.JSX.Element {
  return (
    <span className="help-keys">
      {keys.map((combo) => (
        <span className="help-combo" key={combo.join('+')}>
          {combo.map((token, i) => (
            <span key={token}>
              {i > 0 && '+'}
              <kbd>{label(token, mac)}</kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

type Mode = 'canvas' | 'name' | 'memo';

const HEADINGS: Record<Mode, string> = {
  canvas: 'キャンバス',
  name: '名前の入力中',
  memo: 'メモの入力中',
};

/**
 * フォーカスのある要素から、一覧の中身を決める。
 *
 * 「名前」は Task と childTask の名前だけ。Project 名(枠の中の入力欄)とダイアログの
 * 入力欄(.wide)は対象外 —— Shift+Enter で childTask を足す、などが効かないので、
 * Task 名の一覧を出すと嘘になる。
 */
function modeOf(el: Element | null): Mode {
  if (el?.matches('.text-input:not(.wide)') && !el.closest('.react-flow__node-projectFrame')) {
    return 'name';
  }
  if (el?.matches('.memo-input')) return 'memo';
  return 'canvas';
}

function Row({
  keys,
  description,
  mac,
}: {
  keys: readonly (readonly string[])[];
  description: string;
  mac: boolean;
}): React.JSX.Element {
  return (
    <li>
      <Keys keys={keys} mac={mac} />
      <span className="help-desc">{description}</span>
    </li>
  );
}

/**
 * 右上に常時出す。ミニマップと同じく React Flow の Panel なので、パン・ズームでは動かない。
 * 中身はフォーカスのある場所で切り替える(キャンバス / 名前 / メモ)。
 */
export function HelpPanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const mac = isMac();
  const [mode, setMode] = useState<Mode>('canvas');

  useEffect(() => {
    const onIn = (): void => setMode(modeOf(document.activeElement));
    // focusout の時点の activeElement は body。移り先は relatedTarget にある。
    const onOut = (e: FocusEvent): void => setMode(modeOf(e.relatedTarget as Element | null));
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  if (!open) {
    return (
      <Panel position="top-right" className="nopan nodrag nowheel">
        <button type="button" className="help-collapsed" onClick={onToggle} aria-expanded={false}>
          ? キー操作
        </button>
      </Panel>
    );
  }

  const items =
    mode === 'canvas'
      ? SHORTCUTS.map((s) => ({ id: s.command, keys: s.keys, description: s.description }))
      : (
          INPUT_SHORTCUTS.find((g) => g.title === (mode === 'name' ? '名前' : 'メモ'))?.items ?? []
        ).map((item) => ({
          id: item.keys.map((k) => k.join('+')).join('|'),
          keys: item.keys,
          description: item.description,
        }));

  return (
    <Panel position="top-right" className="nopan nodrag nowheel">
      <aside className="help-panel" aria-label="キー操作">
        <div className="help-head">
          <strong>{HEADINGS[mode]}</strong>
          <button
            type="button"
            className="help-close"
            onClick={onToggle}
            aria-label="たたむ"
            aria-expanded
          >
            ×
          </button>
        </div>
        <ul>
          {items.map((it) => (
            <Row key={it.id} keys={it.keys} description={it.description} mac={mac} />
          ))}
        </ul>
      </aside>
    </Panel>
  );
}
