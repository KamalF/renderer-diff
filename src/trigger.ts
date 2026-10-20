import {LitElement, html, nothing} from 'lit';
import type {PluginApi} from '@gerritcodereview/typescript-api/plugin';
import {isRenderedPath} from './render';

/** The button in the diff header that opens and closes the rendered pane. */
export class RendererDiffTrigger extends LitElement {
  static override properties = {
    plugin: {attribute: false},
    onTrigger: {attribute: false},
    openSidebar: {attribute: false},
  };

  declare plugin?: PluginApi;
  declare onTrigger?: (name: string) => void;
  declare openSidebar?: {name?: string};

  // Gerrit does not give the file path to the trigger. Read it from
  // gr-diff-view. Gerrit sets a new onTrigger function each time that the
  // diff view renders, also when the reviewer goes to another file, so this
  // element renders again with the new path.
  private path(): string | undefined {
    const root = this.getRootNode();
    if (!(root instanceof ShadowRoot)) return undefined;
    return (root.host as HTMLElement & {path?: string}).path;
  }

  override render() {
    if (!this.plugin || !isRenderedPath(this.path())) return nothing;
    const name = this.plugin.getPluginName();
    const open = this.openSidebar?.name === name;
    return html`
      <gr-button link @click=${() => this.onTrigger?.(name)}>
        ${open ? 'Hide rendered' : 'Show rendered'}
      </gr-button>
    `;
  }
}

customElements.define('renderer-diff-trigger', RendererDiffTrigger);
