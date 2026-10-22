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

export function HelpPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const mac = isMac();
  return (
    <aside className="help-panel" aria-label="キー操作">
      <div className="help-head">
        <strong>キー操作</strong>
        <button type="button" className="help-close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      <h3>キャンバス</h3>
      <ul>
        {SHORTCUTS.map((s) => (
          <li key={s.command}>
            <Keys keys={s.keys} mac={mac} />
            <span className="help-desc">{s.description}</span>
          </li>
        ))}
      </ul>

      <h3>名前・メモの入力中</h3>
      {INPUT_SHORTCUTS.map((g) => (
        <section key={g.title}>
          <h4>{g.title}</h4>
          <ul>
            {g.items.map((item) => (
              <li key={item.keys.map((k) => k.join('+')).join('|')}>
                <Keys keys={item.keys} mac={mac} />
                <span className="help-desc">{item.description}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
