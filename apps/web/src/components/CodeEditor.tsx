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
import { useEffect, useMemo, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

export type CodeEditorMode = "monaco" | "codemirror" | "textarea";

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
  if (/\.toml$/.test(file)) return "toml";
  if (/\.sh$/.test(file)) return "shell";
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

function MonacoCodeEditor({ value, path, readOnly, onChange }: Omit<CodeEditorProps, "mode">) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const changeRef = useRef(onChange);

  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    window.MonacoEnvironment ??= {};
    window.MonacoEnvironment.getWorker = () => new EditorWorker();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
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
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, languageFromPath(path));
  }, [path]);

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

  useEffect(() => {
    setFailedMode(null);
  }, [mode, path]);

  if (activeMode === "monaco") {
    try {
      return <MonacoCodeEditor value={value} path={path} readOnly={readOnly} onChange={onChange} />;
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
