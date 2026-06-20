/// <reference types="vite/client" />

declare module "*?worker" {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}

declare module "monaco-editor/esm/vs/editor/editor.api" {
  export * from "monaco-editor";
}

declare module "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
declare module "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
declare module "monaco-editor/esm/vs/basic-languages/python/python.contribution";
declare module "monaco-editor/esm/vs/language/json/monaco.contribution";
declare module "monaco-editor/esm/vs/basic-languages/html/html.contribution";
declare module "monaco-editor/esm/vs/basic-languages/css/css.contribution";
declare module "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
declare module "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
declare module "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
declare module "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
declare module "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
declare module "monaco-editor/esm/vs/basic-languages/go/go.contribution";
declare module "monaco-editor/esm/vs/basic-languages/rust/rust.contribution";
declare module "monaco-editor/esm/vs/basic-languages/java/java.contribution";
declare module "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution";
declare module "monaco-editor/esm/vs/basic-languages/ini/ini.contribution";
