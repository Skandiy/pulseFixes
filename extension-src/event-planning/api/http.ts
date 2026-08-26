export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload?: unknown
  ) {
    super(message);
  }
}

type KvplTask = {
  objectName: string;
  methodName: string;
  params?: Record<string, unknown>;
  id?: string;
};

export type KvplRequest = {
  tasks: KvplTask[];
  info?: Record<string, unknown>;
};

export function getErrorMessage(error: unknown, fallback = 'Ошибка запроса'): string {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return typeof error === 'string' && error.trim() ? error : fallback;
}

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const payload = await executePulseRequest(buildKvplRequest(url, init));
  throwForKvplTaskError(payload);

  return payload as T;
}

export async function executePulseRequest(payload: KvplRequest): Promise<unknown> {
  const id = `trick-plus-event-planning:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new ApiError(408, 'Превышено время ожидания ответа Pulse API'));
    }, 30_000);

    function onMessage(event: MessageEvent): void {
      if (event.source !== window) {
        return;
      }
      if (event.data?.type !== 'WINDOW_EXECUTE_PAGE_REQUEST_RESULT' || event.data.id !== id) {
        return;
      }

      window.clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);

      const response = event.data.response;
      if (response?.ok) {
        resolve(response.data);
        return;
      }

      reject(new ApiError(500, response?.error || 'Ошибка Pulse API', response));
    }

    window.addEventListener('message', onMessage);
    window.postMessage({
      type: 'WINDOW_EXECUTE_PAGE_REQUEST',
      id,
      payload
    }, '*');
  });
}

function buildKvplRequest(url: string, init: RequestInit): KvplRequest {
  const body = parseRequestBody(init.body);

  if (url === '/api/pulse/kvpl') {
    return withDefaultInfo(body as KvplRequest);
  }

  if (url === '/api/calendar/filters') {
    return singleTask('Календарь', 'ПолучитьНаборФильтров', {
      фильтр: { модель: 'Календарь' }
    });
  }

  if (url === '/api/rooms/data') {
    const request = readObject(body);
    return singleTask('Переговорки', 'ПолучитьДанные', {
      фильтр: readObject(request?.filter) ?? {}
    });
  }

  if (url === '/api/rooms/places') {
    const request = readObject(body);
    return singleTask('Места_событий', 'получить', {
      времнач: request?.start ?? null,
      времкнц: request?.end ?? null,
      дата: request?.date ?? null,
      весьдень: readInteger(request?.allDay) ?? 0,
      владелец: readInteger(request?.owner) ?? -1,
      размерСтраницы: readInteger(request?.pageSize) ?? 50,
      смещениеСтраницы: readInteger(request?.pageOffset) ?? 0
    });
  }

  if (url === '/api/dictionaries/active-employees') {
    const request = readObject(body);
    return singleTask('АктивныеСотрудникиВыбор', 'получить', {
      поискПоля: 'фио',
      поискСтрока: typeof request?.search === 'string' ? request.search.trim() : '',
      размерСтраницы: readInteger(request?.pageSize) ?? 50,
      смещениеСтраницы: readInteger(request?.pageOffset) ?? 0
    });
  }

  if (url === '/api/dictionaries/employee-profile') {
    const request = readObject(body);
    return singleTask('Сотрудники', 'получить', {
      номерЗаписи: readInteger(request?.id) ?? 0,
      поля: ['фиократко', 'аватарurl', 'название']
    });
  }

  throw new ApiError(404, `Неподдерживаемый маршрут API планировщика: ${url}`);
}

function singleTask(objectName: string, methodName: string, params: Record<string, unknown> = {}): KvplRequest {
  return withDefaultInfo({
    tasks: [
      {
        objectName,
        methodName,
        params,
        id: createRequestId()
      }
    ]
  });
}

function withDefaultInfo(request: KvplRequest): KvplRequest {
  return {
    ...request,
    info: {
      workMonth: currentWorkMonth(),
      ...(request.info ?? {})
    }
  };
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (!body) {
    return {};
  }
  if (typeof body !== 'string') {
    return {};
  }
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readInteger(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numberValue) ? numberValue : null;
}

function currentWorkMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00.000`;
}

function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatErrorPayload(payload: unknown, fallback: string): string {
  const message = readStringProperty(payload, 'message');
  if (message && message !== 'Invalid request payload') {
    return message;
  }

  const issues = readValidationIssues(payload);
  if (issues.length > 0) {
    return `Некорректные параметры запроса: ${issues.map(formatValidationIssue).join('; ')}`;
  }

  return message || fallback || 'Ошибка запроса';
}

function throwForKvplTaskError(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || !('tasks' in payload)) {
    return;
  }

  const tasks = (payload as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) {
    return;
  }

  const failedTask = tasks.find((task) => Boolean(readTaskError(task)));
  const taskError = readTaskError(failedTask);
  if (!taskError) {
    return;
  }

  const status = readNumberProperty(taskError, 'code') ?? 500;
  const message = readStringProperty(taskError, 'message') || 'Ошибка Pulse API';
  throw new ApiError(status, message, payload);
}

function readTaskError(task: unknown): Record<string, unknown> | null {
  if (!task || typeof task !== 'object' || !('error' in task)) {
    return null;
  }

  const error = (task as { error?: unknown }).error;
  return error && typeof error === 'object' && !Array.isArray(error) ? (error as Record<string, unknown>) : null;
}

function readValidationIssues(payload: unknown): ValidationIssue[] {
  if (!payload || typeof payload !== 'object' || !('issues' in payload)) {
    return [];
  }

  const issues = (payload as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) {
    return [];
  }

  return issues
    .map((issue) => {
      if (!issue || typeof issue !== 'object') {
        return null;
      }
      const pathValue = (issue as { path?: unknown }).path;
      const messageValue = (issue as { message?: unknown }).message;
      const path = Array.isArray(pathValue)
        ? pathValue.map(String).join('.')
        : typeof pathValue === 'string'
          ? pathValue
          : '';
      const message = typeof messageValue === 'string' ? messageValue : '';
      return message ? { path, message } : null;
    })
    .filter((issue): issue is ValidationIssue => issue !== null);
}

function formatValidationIssue(issue: ValidationIssue): string {
  return issue.path ? `${issue.path} - ${issue.message}` : issue.message;
}

function readStringProperty(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object' || !(key in payload)) {
    return '';
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function readNumberProperty(payload: unknown, key: string): number | null {
  if (!payload || typeof payload !== 'object' || !(key in payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[key];
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

type ValidationIssue = {
  path: string;
  message: string;
};
