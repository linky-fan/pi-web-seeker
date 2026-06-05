"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "en" | "zh-CN";

type Vars = Record<string, string | number>;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: string, vars?: Vars) => string;
}

const STORAGE_KEY = "pi-web.locale";

const en: Record<string, string> = {
  "app.brand": "Pi Web Seeker",
  "locale.label": "Language",
  "locale.current": "English",
  "locale.next": "Switch to Chinese",
  "locale.short": "EN",
  "theme.label": "Theme",
  "theme.short": "Theme",
  "nav.models": "Models",
  "nav.skills": "Skills",
  "nav.subagents": "Subagents",
  "nav.agents": "Agents",
  "sidebar.hide": "Hide sidebar",
  "sidebar.show": "Show sidebar",
  "system.label": "System",
  "system.emptyTools": "System prompt is empty (tools are disabled)",
  "system.loadHint": "Send a message to load the system prompt",
  "placeholder.selectSession": "Select a session from the sidebar",
  "placeholder.getStarted": "Get Started",
  "placeholder.stepSelectProject": "Select a project directory from the sidebar",
  "placeholder.stepAddModels": "Add models via the Models button at the bottom",
  "file.noOpen": "No file open",
  "stats.input": "in",
  "stats.output": "out",
  "stats.cacheRead": "cache read",
  "stats.cacheWrite": "cache write",
  "stats.cost": "cost",
  "stats.context": "context",
  "stats.unknown": "unknown",
  "chat.retrying": "Retrying ({attempt}/{maxAttempts})...",
  "chat.placeholder.streamingQueued": "Guide now / queue a follow-up...",
  "chat.placeholder.running": "Agent is running...",
  "chat.placeholder.message": "Message...",
  "chat.steer": "Guide",
  "chat.steerTitle": "Stop the current response, then continue with this guidance as a new message",
  "chat.followUp": "Follow-up",
  "chat.followUpTitle": "Queue this message after the agent finishes",
  "chat.send": "Send",
  "chat.attachImage": "Attach image",
  "chat.attachImageShort": "Image",
  "chat.promptSnippets": "Prompt snippets",
  "chat.promptSnippetsShort": "Prompt",
  "chat.promptSnippetsTitle": "Open prompt snippets and recent prompts",
  "chat.thinkingTitle": "Change thinking level",
  "chat.toolsTitle": "Change tool preset",
  "chat.stop": "Stop",
  "chat.stopTitle": "Stop agent",
  "chat.soundOnTitle": "Disable completion sound",
  "chat.soundOffTitle": "Enable completion sound",
  "chat.compact": "Compact",
  "chat.compacting": "Compacting...",
  "chat.compactAction": "Compact context",
  "chat.stopCompactAction": "Stop compaction",
  "chat.contextUnavailable": "Context: unavailable",
  "chat.contextUsage": "Context usage {label}",
  "chat.contextUsageUnavailable": "Context usage unavailable",
  "thinking.auto": "Use pi default",
  "thinking.off": "Disable thinking",
  "thinking.minimal": "Minimal thinking",
  "thinking.low": "Low thinking",
  "thinking.medium": "Medium thinking",
  "thinking.high": "High thinking",
  "thinking.xhigh": "Maximum thinking",
  "tools.offDesc": "No tools, chat only",
  "tools.defaultDesc": "4 built-in tools + extensions",
  "tools.fullDesc": "All built-in tools + extensions",
  "snippets.review": "Review",
  "snippets.explain": "Explain",
  "snippets.tests": "Tests",
  "snippets.refactor": "Refactor",
  "snippets.summarize": "Summarize",
  "explorer.loading": "Loading files...",
  "explorer.search": "Search files",
  "explorer.showAll": "Show all files",
  "explorer.trackedOnly": "Only show git-tracked files",
  "explorer.notGit": "Not a git repository",
  "explorer.searching": "Searching...",
  "explorer.noMatches": "No matches",
  "explorer.recent": "Recent",
  "explorer.noFiles": "No files found",
  "explorer.empty": "empty",
  "explorer.download": "Download file",
  "explorer.insertPath": "Insert path into chat",
  "subagents.title": "Subagents",
  "subagents.close": "Close",
  "subagents.status": "Status",
  "subagents.loaded": "Loaded",
  "subagents.configured": "Configured",
  "subagents.notDetected": "Not detected",
  "subagents.checking": "Checking...",
  "subagents.copyInstall": "Copy install",
  "subagents.copied": "Copied",
  "subagents.copy": "Copy",
  "subagents.installCommand": "Install Command",
  "subagents.installVariants": "Install Variants",
  "subagents.copyCommand": "Copy command",
  "subagents.refreshStatus": "Refresh status",
  "subagents.copyPrompt": "Copy test prompt",
  "subagents.copiedPrompt": "Copied prompt",
  "subagents.runtime": "Runtime",
  "subagents.agentDir": "agent dir",
  "subagents.docker": "docker",
  "subagents.yes": "yes",
  "subagents.no": "no",
  "subagents.applyHint": "Extension changes apply when a new AgentSession starts. After installing or fixing load errors, refresh this status and open a new chat before testing.",
  "subagents.loadedExtensions": "Loaded Extensions",
  "subagents.noLoaded": "No pi-subagents extension loaded for this cwd.",
  "subagents.configuredPackages": "Configured Packages",
  "subagents.loadErrors": "Load Errors",
  "subagents.tools": "{count} tools",
  "subagents.commands": "{count} commands",
  "subagents.renderers": "{count} renderers",
  "branches.label": "Branches",
  "branches.labelBranch": "Label branch",
  "branches.none": "None",
  "branches.more": "+{count} more",
  "branches.previewHint": "Hover a branch to preview the path difference.",
  "branches.preview": "Preview",
  "branches.current": "Current branch",
  "branches.diff": "{out} messages out · {in} messages in",
  "branches.addLabel": "Add branch label",
  "branches.clearLabel": "Clear label",
  "branches.leaving": "Leaving",
  "branches.entering": "Entering",
  "branches.currentPath": "Current path",
  "branches.noSession": "No active session",
  "branches.noBranches": "This session has no branches",
  "sidebar.useDefaultDirectory": "Use default directory",
  "sidebar.customPath": "Custom path...",
  "sidebar.open": "Open",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "sidebar.deleteConfirm": "Delete \"{title}\"?",
  "tools.noTools": "No tools enabled",
  "tools.noneWarning": " - agent will not use any tools",
  "toolPanel.none.label": "Off",
  "toolPanel.default.label": "Low",
  "toolPanel.full.label": "High",
  "toolPanel.none.desc": "No tools",
  "toolPanel.default.desc": "read · bash · edit · write · enabled extensions",
  "toolPanel.full.desc": "read · bash · edit · write · grep · find · ls · enabled extensions",
  "viewer.largeFile": "Large file: syntax highlighting disabled for faster preview.",
  "viewer.largeDiff": "Diff is disabled for large file updates.",
  "viewer.truncated": "Showing first {shown} of {total} lines.",
  "viewer.markdownTooLarge": "Markdown preview is disabled for files over {size}. Switch to Raw to inspect it.",
  "message.thinking": "Thinking",
};

const zhCN: Record<string, string> = {
  "locale.current": "简体中文",
  "locale.next": "切换到英文",
  "locale.short": "中",
  "theme.label": "主题",
  "theme.short": "主题",
  "nav.models": "模型",
  "nav.skills": "技能",
  "nav.subagents": "子智能体",
  "nav.agents": "智能体",
  "sidebar.hide": "隐藏侧边栏",
  "sidebar.show": "显示侧边栏",
  "system.label": "系统",
  "system.emptyTools": "系统提示词为空（工具已禁用）",
  "system.loadHint": "发送一条消息后加载系统提示词",
  "placeholder.selectSession": "从侧边栏选择一个会话",
  "placeholder.getStarted": "开始使用",
  "placeholder.stepSelectProject": "从侧边栏选择项目目录",
  "placeholder.stepAddModels": "通过底部的模型按钮添加模型",
  "file.noOpen": "未打开文件",
  "stats.input": "输入",
  "stats.output": "输出",
  "stats.cacheRead": "缓存读",
  "stats.cacheWrite": "缓存写",
  "stats.cost": "费用",
  "stats.context": "上下文",
  "stats.unknown": "未知",
  "chat.retrying": "正在重试（{attempt}/{maxAttempts}）...",
  "chat.placeholder.streamingQueued": "输入引导立即接管 / Follow-up 排队...",
  "chat.placeholder.running": "智能体正在运行...",
  "chat.placeholder.message": "输入消息...",
  "chat.steer": "引导",
  "chat.steerTitle": "停止当前响应，并在当前轮收尾后把引导作为新消息继续",
  "chat.followUp": "Follow-up",
  "chat.followUpTitle": "在智能体完成后排队发送",
  "chat.send": "发送",
  "chat.attachImage": "附加图片",
  "chat.attachImageShort": "图片",
  "chat.promptSnippets": "提示词片段",
  "chat.promptSnippetsShort": "提示词",
  "chat.promptSnippetsTitle": "打开提示词片段和历史输入",
  "chat.thinkingTitle": "切换推理强度",
  "chat.toolsTitle": "切换工具预设",
  "chat.stop": "停止",
  "chat.stopTitle": "停止智能体",
  "chat.soundOnTitle": "关闭完成提示音",
  "chat.soundOffTitle": "开启完成提示音",
  "chat.compact": "压缩",
  "chat.compacting": "压缩中...",
  "chat.compactAction": "压缩上下文",
  "chat.stopCompactAction": "停止压缩",
  "chat.contextUnavailable": "Context: unavailable",
  "chat.contextUsage": "上下文使用量 {label}",
  "chat.contextUsageUnavailable": "上下文使用量不可用",
  "thinking.auto": "沿用 pi 默认设置",
  "thinking.off": "关闭推理",
  "thinking.minimal": "最少推理",
  "thinking.low": "低强度推理",
  "thinking.medium": "中等推理",
  "thinking.high": "高强度推理",
  "thinking.xhigh": "最高强度推理",
  "tools.offDesc": "无工具，纯聊天",
  "tools.defaultDesc": "4 项内置工具 + 扩展",
  "tools.fullDesc": "全部内置工具 + 扩展",
  "snippets.review": "审查",
  "snippets.explain": "解释",
  "snippets.tests": "测试",
  "snippets.refactor": "重构",
  "snippets.summarize": "总结",
  "explorer.loading": "正在加载文件...",
  "explorer.search": "搜索文件",
  "explorer.showAll": "显示全部文件",
  "explorer.trackedOnly": "仅显示 git 跟踪文件",
  "explorer.notGit": "不是 git 仓库",
  "explorer.searching": "正在搜索...",
  "explorer.noMatches": "没有匹配项",
  "explorer.recent": "最近",
  "explorer.noFiles": "未找到文件",
  "explorer.empty": "空",
  "explorer.download": "下载文件",
  "explorer.insertPath": "插入路径到聊天",
  "subagents.title": "子智能体",
  "subagents.close": "关闭",
  "subagents.status": "状态",
  "subagents.loaded": "已加载",
  "subagents.configured": "已配置",
  "subagents.notDetected": "未检测到",
  "subagents.checking": "正在检查...",
  "subagents.copyInstall": "复制安装命令",
  "subagents.copied": "已复制",
  "subagents.copy": "复制",
  "subagents.installCommand": "安装命令",
  "subagents.installVariants": "安装方式",
  "subagents.copyCommand": "复制命令",
  "subagents.refreshStatus": "刷新状态",
  "subagents.copyPrompt": "复制测试提示词",
  "subagents.copiedPrompt": "已复制提示词",
  "subagents.runtime": "运行环境",
  "subagents.agentDir": "agent 目录",
  "subagents.docker": "docker",
  "subagents.yes": "是",
  "subagents.no": "否",
  "subagents.applyHint": "扩展变更会在新的 AgentSession 启动时生效。安装或修复加载错误后，请刷新状态并打开新聊天再测试。",
  "subagents.loadedExtensions": "已加载扩展",
  "subagents.noLoaded": "当前 cwd 没有加载 pi-subagents 扩展。",
  "subagents.configuredPackages": "已配置包",
  "subagents.loadErrors": "加载错误",
  "subagents.tools": "{count} 个工具",
  "subagents.commands": "{count} 个命令",
  "subagents.renderers": "{count} 个渲染器",
  "branches.label": "分支",
  "branches.labelBranch": "标记分支",
  "branches.none": "无",
  "branches.more": "+{count} 更多",
  "branches.previewHint": "悬停分支以预览路径差异。",
  "branches.preview": "预览",
  "branches.current": "当前分支",
  "branches.diff": "{out} 条消息移出 · {in} 条消息进入",
  "branches.addLabel": "添加分支标签",
  "branches.clearLabel": "清除标签",
  "branches.leaving": "离开",
  "branches.entering": "进入",
  "branches.currentPath": "当前路径",
  "branches.noSession": "没有活动会话",
  "branches.noBranches": "这个会话没有分支",
  "sidebar.useDefaultDirectory": "使用默认目录",
  "sidebar.customPath": "自定义路径...",
  "sidebar.open": "打开",
  "common.cancel": "取消",
  "common.delete": "删除",
  "sidebar.deleteConfirm": "删除 \"{title}\"？",
  "tools.noTools": "未启用工具",
  "tools.noneWarning": " - 智能体不会使用任何工具",
  "toolPanel.none.label": "关闭",
  "toolPanel.default.label": "低",
  "toolPanel.full.label": "高",
  "toolPanel.none.desc": "无工具",
  "toolPanel.default.desc": "read · bash · edit · write · 已启用扩展",
  "toolPanel.full.desc": "read · bash · edit · write · grep · find · ls · 已启用扩展",
  "viewer.largeFile": "大文件：已关闭语法高亮以加快预览。",
  "viewer.largeDiff": "大文件更新已关闭 diff 显示。",
  "viewer.truncated": "正在显示前 {shown} 行，共 {total} 行。",
  "viewer.markdownTooLarge": "超过 {size} 的文件已关闭 Markdown 预览。切换到 Raw 可查看内容。",
  "message.thinking": "思考",
};

const dictionaries: Record<Locale, Record<string, string>> = {
  en,
  "zh-CN": zhCN,
};

function normalizeLocale(value: unknown): Locale {
  return value === "zh-CN" ? "zh-CN" : "en";
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  ));
}

const fallbackContext: LocaleContextValue = {
  locale: "en",
  setLocale: () => {},
  toggleLocale: () => {},
  t: (key, vars) => interpolate(en[key] ?? key, vars),
};

const LocaleContext = createContext<LocaleContextValue>(fallbackContext);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    try {
      setLocaleState(normalizeLocale(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      // Keep English fallback when storage is unavailable.
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable in restricted contexts.
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "zh-CN" ? "en" : "zh-CN");
  }, [locale, setLocale]);

  const t = useCallback((key: string, vars?: Vars) => {
    const template = dictionaries[locale][key] ?? en[key] ?? key;
    return interpolate(template, vars);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, toggleLocale, t }), [locale, setLocale, toggleLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
