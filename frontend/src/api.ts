import type { PaginatedTasks, TaskCreateResponse, TaskItem, TaskResultResponse } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const MOCK_MODE = (import.meta.env.VITE_MOCK_MODE ?? "true").toLowerCase() !== "false";
const TOKEN_KEY = "token";
const USERS_KEY = "vp_users";
const ACTIVE_USER_KEY = "vp_active_user";

type LocalUser = {
  company: string;
  username: string;
  password: string;
};

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function ensureUsers(): LocalUser[] {
  const raw = localStorage.getItem(USERS_KEY);
  if (raw) {
    return JSON.parse(raw) as LocalUser[];
  }

  const defaults: LocalUser[] = [
    { company: "苏州小棉袄电商公司", username: "demo", password: "demo123" }
  ];
  localStorage.setItem(USERS_KEY, JSON.stringify(defaults));
  return defaults;
}

function saveUsers(users: LocalUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function setActiveUser(username: string): void {
  localStorage.setItem(ACTIVE_USER_KEY, username);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    let detail = `请求失败（${response.status}）`;
    try {
      const data = await response.json();
      detail = data.detail ?? detail;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export async function register(company: string, username: string, password: string): Promise<void> {
  const users = ensureUsers();
  if (users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("用户名已存在");
  }

  users.push({
    company: company.trim(),
    username: username.trim(),
    password
  });
  saveUsers(users);
}

export async function login(username: string, password: string): Promise<void> {
  if (MOCK_MODE) {
    const users = ensureUsers();
    const matched = users.find(
      (item) => item.username.toLowerCase() === username.toLowerCase() && item.password === password
    );

    if (!matched) {
      throw new Error("用户名或密码错误");
    }

    saveToken(`mock-token-${matched.username}`);
    setActiveUser(matched.username);
    return;
  }

  const response = await request<{ access_token: string }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  saveToken(response.access_token);
  setActiveUser(username);
}

export function getActiveUser(): string {
  return localStorage.getItem(ACTIVE_USER_KEY) ?? "用户";
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACTIVE_USER_KEY);
}

export function isAuthed(): boolean {
  return Boolean(getToken());
}

export function isMockModeEnabled(): boolean {
  return MOCK_MODE;
}

export async function uploadVideo(file: File, signal?: AbortSignal): Promise<TaskCreateResponse> {
  const form = new FormData();
  form.append("file", file);

  return request<TaskCreateResponse>("/api/videos/upload", {
    method: "POST",
    body: form,
    signal
  });
}

export async function createTaskByUrl(url: string, signal?: AbortSignal): Promise<TaskCreateResponse> {
  return request<TaskCreateResponse>("/api/videos/by-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal
  });
}

export async function fetchTask(taskId: string, signal?: AbortSignal): Promise<TaskItem> {
  return request<TaskItem>(`/api/tasks/${taskId}`, { signal });
}

export async function fetchTaskResult(taskId: string, signal?: AbortSignal): Promise<TaskResultResponse> {
  return request<TaskResultResponse>(`/api/tasks/${taskId}/result`, { signal });
}

export async function fetchTasks(page = 1, pageSize = 10, signal?: AbortSignal): Promise<PaginatedTasks> {
  return request<PaginatedTasks>(`/api/tasks?page=${page}&page_size=${pageSize}`, { signal });
}

export async function retryTask(taskId: string, signal?: AbortSignal): Promise<TaskItem> {
  return request<TaskItem>(`/api/tasks/${taskId}/retry`, {
    method: "POST",
    signal
  });
}

export function artifactUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:image")) {
    return path;
  }
  return `${API_BASE}${path}`;
}
