import '@gerritcodereview/typescript-api/gerrit';
import './pane';
import './trigger';

window.Gerrit?.install(plugin => {
  plugin.registerCustomComponent('sidebarTrigger', 'renderer-diff-trigger');
  plugin.registerCustomComponent(
    `sidebarContent-${plugin.getPluginName()}`,
    'renderer-diff-pane'
  );
});
