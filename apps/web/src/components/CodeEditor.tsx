import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";

export type CodeEditorMode = "monaco" | "codemirror" | "textarea";
type MonacoBundle = {
  monaco: typeof Monaco;
  EditorWorker: { new (): Worker };
};

type CodeEditorProps = {
  mode: CodeEditorMode;
  value: string;
  path?: string | null;
  readOnly?: boolean;
  onChange: (value: string) => void;
};

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker?: () => Worker;
    };
  }
}

let monacoBundlePromise: Promise<MonacoBundle> | null = null;

function loadMonacoBundle() {
  monacoBundlePromise ??= Promise.all([
    import("monaco-editor/esm/vs/editor/editor.api"),
    import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution"),
    import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution"),
    import("monaco-editor/esm/vs/basic-languages/python/python.contribution"),
    import("monaco-editor/esm/vs/language/json/monaco.contribution"),
    import("monaco-editor/esm/vs/basic-languages/html/html.contribution"),
    import("monaco-editor/esm/vs/basic-languages/css/css.contribution"),
    import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution"),
    import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution"),
    import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution"),
    import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution"),
    import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution"),
    import("monaco-editor/esm/vs/basic-languages/go/go.contribution"),
    import("monaco-editor/esm/vs/basic-languages/rust/rust.contribution"),
    import("monaco-editor/esm/vs/basic-languages/java/java.contribution"),
    import("monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution"),
    import("monaco-editor/esm/vs/basic-languages/ini/ini.contribution"),
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
  ]).then(([monaco, ...modules]) => {
    const workerModule = modules[modules.length - 1] as { default: { new (): Worker } };
    return {
      monaco,
      EditorWorker: workerModule.default,
    };
  });
  return monacoBundlePromise;
}

function languageFromPath(path?: string | null) {
  const file = (path ?? "").toLowerCase();
  if (/\.(ts|tsx|mts|cts)$/.test(file)) return "typescript";
  if (/\.(js|jsx|mjs|cjs)$/.test(file)) return "javascript";
  if (/\.jsonc?$/.test(file)) return "json";
  if (/\.(md|markdown|mdx)$/.test(file)) return "markdown";
  if (/\.py$/.test(file)) return "python";
  if (/\.(html|htm)$/.test(file)) return "html";
  if (/\.css$/.test(file)) return "css";
  if (/\.(scss|sass|less)$/.test(file)) return "css";
  if (/\.sql$/.test(file)) return "sql";
  if (/\.(xml|svg)$/.test(file)) return "xml";
  if (/\.ya?ml$/.test(file)) return "yaml";
  if (/\.(toml|ini|env)$/.test(file) || /(^|\/)\.env(\.|$)/.test(file)) return "ini";
  if (/\.(sh|bash|zsh)$/.test(file)) return "shell";
  if (/\.go$/.test(file)) return "go";
  if (/\.rs$/.test(file)) return "rust";
  if (/\.java$/.test(file)) return "java";
  if (/(^|\/)(dockerfile|containerfile)$/.test(file) || /\.(dockerfile|containerfile)$/.test(file)) return "dockerfile";
  return "plaintext";
}

function codeMirrorLanguage(path?: string | null) {
  const language = languageFromPath(path);
  if (language === "typescript") return javascript({ jsx: true, typescript: true });
  if (language === "javascript") return javascript({ jsx: true });
  if (language === "json") return json();
  if (language === "markdown") return markdown();
  if (language === "python") return python();
  if (language === "html") return html();
  if (language === "css") return css();
  if (language === "sql") return sql();
  if (language === "xml") return xml();
  return [];
}

export function preferredCodeEditorMode() {
  if (typeof window === "undefined") return "monaco" as CodeEditorMode;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
  const narrow = window.matchMedia?.("(max-width: 760px)")?.matches;
  return coarsePointer || narrow ? "codemirror" : "monaco";
}

function MonacoCodeEditor({ value, path, readOnly, onChange, onLoadError }: Omit<CodeEditorProps, "mode"> & { onLoadError: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [bundle, setBundle] = useState<MonacoBundle | null>(null);
  const changeRef = useRef(onChange);

  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    loadMonacoBundle()
      .then((loadedBundle) => {
        if (!cancelled) setBundle(loadedBundle);
      })
      .catch(() => {
        if (!cancelled) onLoadError();
      });
    return () => {
      cancelled = true;
    };
  }, [onLoadError]);

  useEffect(() => {
    if (!containerRef.current || !bundle) return;
    window.MonacoEnvironment ??= {};
    window.MonacoEnvironment.getWorker = () => new bundle.EditorWorker();
    const editor = bundle.monaco.editor.create(containerRef.current, {
      value,
      language: languageFromPath(path),
      readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 20,
      scrollBeyondLastLine: false,
      wordWrap: "on",
    });
    editorRef.current = editor;
    const subscription = editor.onDidChangeModelContent(() => {
      changeRef.current(editor.getValue());
    });
    return () => {
      subscription.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, [bundle]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model && bundle) bundle.monaco.editor.setModelLanguage(model, languageFromPath(path));
  }, [path, bundle]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  return <div className="code-editor code-editor-monaco" ref={containerRef} />;
}

function CodeMirrorEditor({ value, path, readOnly, onChange }: Omit<CodeEditorProps, "mode">) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useMemo(() => new Compartment(), []);
  const editableCompartment = useMemo(() => new Compartment(), []);
  const changeRef = useRef(onChange);

  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        languageCompartment.of(codeMirrorLanguage(path)),
        editableCompartment.of(EditorView.editable.of(!readOnly)),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changeRef.current(update.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageCompartment.reconfigure(codeMirrorLanguage(path)) });
  }, [path, languageCompartment]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [readOnly, editableCompartment]);

  return <div className="code-editor code-editor-codemirror" ref={containerRef} />;
}

export function CodeEditor({ mode, value, path, readOnly, onChange }: CodeEditorProps) {
  const [failedMode, setFailedMode] = useState<CodeEditorMode | null>(null);
  const activeMode = failedMode === mode ? "textarea" : mode;
  const handleMonacoLoadError = useCallback(() => setFailedMode("monaco"), []);

  useEffect(() => {
    setFailedMode(null);
  }, [mode, path]);

  if (activeMode === "monaco") {
    try {
      return <MonacoCodeEditor value={value} path={path} readOnly={readOnly} onChange={onChange} onLoadError={handleMonacoLoadError} />;
    } catch {
      setFailedMode("monaco");
    }
  }

  if (activeMode === "codemirror") {
    try {
      return <CodeMirrorEditor value={value} path={path} readOnly={readOnly} onChange={onChange} />;
    } catch {
      setFailedMode("codemirror");
    }
  }

  return (
    <textarea
      name="file-editor-textarea"
      className="large-code file-editor"
      value={value}
      spellCheck={false}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
