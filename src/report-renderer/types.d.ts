/**
 * Ambient module declarations for markdown-it plugins that don't ship their
 * own types and don't have an `@types/...` package on npm. We only need a
 * minimal signature so they can be `.use()`-d on a markdown-it instance.
 */
declare module "markdown-it-attrs" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginWithOptions<unknown>;
  export default plugin;
}

declare module "markdown-it-deflist" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}

declare module "markdown-it-footnote" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}

declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginWithOptions<{ enabled?: boolean }>;
  export default plugin;
}

declare module "markdown-it-container" {
  import type MarkdownIt from "markdown-it";
  type Render = (tokens: unknown[], idx: number) => string;
  interface ContainerOptions {
    render?: Render;
    validate?: (params: string) => boolean;
    marker?: string;
  }
  const plugin: (md: MarkdownIt, name: string, options?: ContainerOptions) => MarkdownIt;
  export default plugin;
}
