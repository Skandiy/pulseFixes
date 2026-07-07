import { apiFetch } from './http';
import type { KvplRequest } from './http';

const pulseStorageBaseUrl = 'https://pulse.stack-it.ru/storage/pulse/';
const birthdayCalendarEventTypeId = 2;
const absenceCalendarEventTypeId = 3;

export type EventPlace = {
  id: string;
  title: string;
};

export type RoomBusyBlock = {
  id: string;
  title: string;
  start: string;
  end: string;
  placeId: string;
  placeName: string;
  author: string;
};

export type RoomAvailability = {
  id: string;
  name: string;
  blocks: RoomBusyBlock[];
};

export type ActiveEmployee = {
  id: string;
  name: string;
  fullName: string;
  avatarUrl: string;
  status: number | null;
  statusText: string;
};

export type ActiveEmployeesPage = {
  items: ActiveEmployee[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
};

export type EmployeeProfile = {
  id: string;
  name: string;
  title: string;
  avatarUrl: string;
};

export type EmployeeCalendarEventType = 'event' | 'absence' | 'vacation';

export type CalendarEventTypeDefinition = {
  id: number;
  name: string;
  color: string;
  cssColor: string;
  backgroundColor: string;
  textColor: string;
  value: number;
};

export type EmployeeCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  type: EmployeeCalendarEventType;
  eventTypeId: number | null;
  allDay: boolean;
  place: string;
  displayTime?: string;
  birthdayEmployeeId: string;
  birthdayEmployeeName: string;
};

export type EmployeeWorkSchedule = {
  start: string;
  end: string;
  label: string;
};

export type EmployeeWorkInfo = {
  schedule: EmployeeWorkSchedule | null;
  birthdayDate: string;
};

export type EmployeeAbsenceSchedule = {
  id: string;
  title: string;
  start: string;
  end: string;
  type: Extract<EmployeeCalendarEventType, 'absence' | 'vacation'>;
  allDay: boolean;
  place: string;
  displayTime: string;
};

type RoomsDataRequest = {
  filter?: Record<string, unknown>;
};

type CalendarEventsRequest = {
  from: string;
  to: string;
  filter?: Record<string, unknown>;
};

type EventPlacesRequest = {
  start?: string | null;
  end?: string | null;
  date?: string | null;
  allDay?: number;
  owner?: number;
  pageSize?: number;
  pageOffset?: number;
};

type ActiveEmployeesRequest = {
  pageSize?: number;
  pageOffset?: number;
  search?: string;
};

type EmployeeProfileRequest = {
  id: string | number;
};

export function getCalendarFilters() {
  return apiFetch<unknown>('/api/calendar/filters');
}

export function getCalendarEvents(payload: CalendarEventsRequest) {
  return apiFetch<unknown>('/api/calendar/events', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function getCalendarEventTypes(payload: { date?: string } = {}) {
  const date = payload.date ?? new Date().toISOString().slice(0, 10);
  const request: KvplRequest = {
    tasks: [
      {
        objectName: 'Календарь',
        methodName: 'ПолучитьТипыСобытий',
        params: {},
        id: createRequestId()
      }
    ],
    info: {
      workMonth: workMonthForDate(date)
    }
  };

  const response = await apiFetch<unknown>('/api/pulse/kvpl', {
    method: 'POST',
    body: JSON.stringify(request)
  });
  return parseCalendarEventTypes(response);
}

export function getTaskFilters() {
  return apiFetch<unknown>('/api/tasks/filters');
}

export function getMyTasks(payload: { sprint?: number; filter?: Record<string, unknown> } = {}) {
  return apiFetch<unknown>('/api/tasks/my', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getRoomFilters() {
  return apiFetch<unknown>('/api/rooms/filters');
}

export function getRoomsData(payload: RoomsDataRequest = {}) {
  return apiFetch<unknown>('/api/rooms/data', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function getRoomAvailability(payload: RoomsDataRequest = {}) {
  const response = await getRoomsData(payload);
  return parseRoomAvailability(response);
}

export async function getEventPlaces(payload: EventPlacesRequest = {}) {
  const response = await apiFetch<unknown>('/api/rooms/places', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return parseEventPlaces(response);
}

export async function getActiveEmployees(payload: ActiveEmployeesRequest = {}) {
  const pageSize = payload.pageSize ?? 50;
  const pageOffset = payload.pageOffset ?? 0;
  const search = payload.search?.trim() ?? '';
  const response = await apiFetch<unknown>('/api/dictionaries/active-employees', {
    method: 'POST',
    body: JSON.stringify({ pageSize, pageOffset, search })
  });
  return parseActiveEmployees(response, pageSize, pageOffset);
}

export async function getEmployeeProfile(id: EmployeeProfileRequest['id']) {
  const response = await apiFetch<unknown>('/api/dictionaries/employee-profile', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
  return parseEmployeeProfile(response);
}

export async function getEmployeeCalendarEvents(payload: { employeeId: string | number; date: string }) {
  const employeeId = Number(payload.employeeId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error(`Некорректный идентификатор сотрудника: ${String(payload.employeeId)}`);
  }

  const request: KvplRequest = {
    tasks: [
      {
        objectName: 'Календарь',
        methodName: 'ПолучитьСобытия',
        params: {
          датнач: payload.date,
          даткнц: payload.date,
          фильтр: {
            сотрудник: JSON.stringify({ value: employeeId, fieldType: 5 }),
            внутренние: '0,1,2,3,4,5',
            внешние: 'google'
          }
        },
        id: createRequestId()
      }
    ],
    info: {
      workMonth: workMonthForDate(payload.date)
    }
  };

  const response = await apiFetch<unknown>('/api/pulse/kvpl', {
    method: 'POST',
    body: JSON.stringify(request)
  });

  return parseEmployeeCalendarEvents(response, String(employeeId));
}

export async function getEmployeeWorkSchedule(payload: { employeeId: string | number; date: string }) {
  const employeeId = Number(payload.employeeId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error(`Некорректный идентификатор сотрудника: ${String(payload.employeeId)}`);
  }

  const request: KvplRequest = {
    tasks: [
      {
        objectName: 'Сотрудники',
        methodName: 'получить',
        params: {
          номерЗаписи: String(employeeId)
        },
        id: createRequestId()
      }
    ],
    info: {
      workMonth: workMonthForDate(payload.date)
    }
  };

  const response = await apiFetch<unknown>('/api/pulse/kvpl', {
    method: 'POST',
    body: JSON.stringify(request)
  });

  return parseEmployeeWorkInfo(response);
}

export async function getEmployeeAbsenceSchedule(payload: { employeeId: string | number; date: string }) {
  const employeeId = Number(payload.employeeId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error(`Некорректный идентификатор сотрудника: ${String(payload.employeeId)}`);
  }

  const request: KvplRequest = {
    tasks: [
      {
        objectName: 'ГрафикРаботы',
        methodName: 'ПолучитьБлижайшееРасписаниеСотрудника',
        params: {
          сотрудник: String(employeeId)
        },
        id: createRequestId()
      }
    ],
    info: {
      workMonth: workMonthForDate(payload.date)
    }
  };

  const response = await apiFetch<unknown>('/api/pulse/kvpl', {
    method: 'POST',
    body: JSON.stringify(request)
  });

  return parseEmployeeAbsenceSchedule(response, String(employeeId), payload.date);
}

export function findEventParticipants(payload: {
  search?: string;
  date?: string;
  start?: string;
  end?: string;
  allDay?: number;
  pageSize?: number;
  pageOffset?: number;
}) {
  return apiFetch<unknown>('/api/events/participants', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getEmployees(ids: string[] = []) {
  return apiFetch<unknown>(`/api/dictionaries/employees?ids=${encodeURIComponent(ids.join(','))}`);
}

export function getProjects(ids: string[] = []) {
  return apiFetch<unknown>(`/api/dictionaries/projects?ids=${encodeURIComponent(ids.join(','))}`);
}

function parseEventPlaces(response: unknown): EventPlace[] {
  const result = readFirstKvplResult(response);
  if (!result || typeof result !== 'object') {
    return [];
  }

  const fields = Array.isArray((result as { поля?: unknown }).поля) ? (result as { поля: unknown[] }).поля : [];
  const records = Array.isArray((result as { записи?: unknown }).записи) ? (result as { записи: unknown[] }).записи : [];
  const idIndex = fields.findIndex((field) => field === '$номерЗаписи');
  const titleIndex = fields.findIndex((field) => field === 'название');

  if (idIndex < 0 || titleIndex < 0) {
    return [];
  }

  return records
    .filter((record): record is unknown[] => Array.isArray(record))
    .map((record) => {
      const id = record[idIndex];
      const title = record[titleIndex];
      return {
        id: typeof id === 'string' || typeof id === 'number' ? String(id) : '',
        title: typeof title === 'string' ? title.trim() : ''
      };
    })
    .filter((place) => place.id && place.title);
}

function parseActiveEmployees(response: unknown, pageSize: number, pageOffset: number): ActiveEmployeesPage {
  const result = readFirstKvplResult(response);
  if (!result || typeof result !== 'object') {
    return { items: [], total: 0, nextOffset: pageOffset, hasMore: false };
  }

  const fields = Array.isArray((result as { поля?: unknown }).поля) ? (result as { поля: unknown[] }).поля : [];
  const records = Array.isArray((result as { записи?: unknown }).записи) ? (result as { записи: unknown[] }).записи : [];
  const total = typeof (result as { всегоЗаписей?: unknown }).всегоЗаписей === 'number'
    ? (result as { всегоЗаписей: number }).всегоЗаписей
    : pageOffset + records.length;

  const idIndex = fields.findIndex((field) => field === '$номерЗаписи');
  const shortNameIndex = fields.findIndex((field) => field === 'фиократко');
  const fullNameIndex = fields.findIndex((field) => field === 'фио');
  const statusIndex = fields.findIndex((field) => field === 'статус');
  const statusTextIndex = fields.findIndex((field) => field === 'статусстрока');

  const items = records
    .filter((record): record is unknown[] => Array.isArray(record))
    .map((record) => {
      const id = readStringId(record[idIndex]);
      const shortName = typeof record[shortNameIndex] === 'string' ? record[shortNameIndex].trim() : '';
      const fullName = typeof record[fullNameIndex] === 'string' ? record[fullNameIndex].trim() : '';
      const status = typeof record[statusIndex] === 'number' ? record[statusIndex] : null;
      const statusText = typeof record[statusTextIndex] === 'string' ? record[statusTextIndex].trim() : '';
      const avatarUrl = buildPulseStorageUrl(readStringField(record, fields, 'аватарurl'));
      return {
        id,
        name: shortName || fullName,
        fullName,
        avatarUrl,
        status,
        statusText
      };
    })
    .filter((employee) => employee.id && employee.name);

  const nextOffset = pageOffset + records.length;
  return {
    items,
    total,
    nextOffset,
    hasMore: records.length >= pageSize && nextOffset < total
  };
}

function parseCalendarEventTypes(response: unknown): CalendarEventTypeDefinition[] {
  const result = readFirstKvplResult(response);
  if (!Array.isArray(result)) {
    return [];
  }

  return result
    .map((item) => {
      const record = readObject(item);
      if (!record) {
        return null;
      }

      const id = readNumberValue(record.id);
      const name = readStringValue(record.name);
      const color = readStringValue(record.color);
      if (id === null || !Number.isInteger(id) || !name) {
        return null;
      }

      const cssColor = normalizePulseColor(color);
      return {
        id,
        name,
        color,
        cssColor,
        backgroundColor: cssColor,
        textColor: 'var(--v-ty-primary-base)',
        value: readNumberValue(record.value) ?? 0
      };
    })
    .filter((item): item is CalendarEventTypeDefinition => item !== null);
}

function parseEmployeeProfile(response: unknown): EmployeeProfile | null {
  const result = readFirstKvplResult(response);
  if (!result || typeof result !== 'object') {
    return null;
  }

  const fields = Array.isArray((result as { поля?: unknown }).поля) ? (result as { поля: unknown[] }).поля : [];
  const records = Array.isArray((result as { записи?: unknown }).записи) ? (result as { записи: unknown[] }).записи : [];
  const record = records.find((item): item is unknown[] => Array.isArray(item));
  if (!record) {
    return null;
  }

  const idIndex = fields.findIndex((field) => field === '$номерЗаписи');
  const shortNameIndex = fields.findIndex((field) => field === 'фиократко');
  const fullNameIndex = fields.findIndex((field) => field === 'фио');
  const titleIndex = fields.findIndex((field) => field === 'название' || field === 'должность');
  const id = readStringId(record[idIndex]);
  const shortName = typeof record[shortNameIndex] === 'string' ? record[shortNameIndex].trim() : '';
  const fullName = typeof record[fullNameIndex] === 'string' ? record[fullNameIndex].trim() : '';
  const title = typeof record[titleIndex] === 'string' ? record[titleIndex].trim() : '';
  const avatarUrl = buildPulseStorageUrl(readStringField(record, fields, 'аватарurl'));
  const name = shortName || fullName;

  return id && name
    ? {
        id,
        name,
        title,
        avatarUrl
      }
    : null;
}

function parseEmployeeCalendarEvents(response: unknown, employeeId: string): EmployeeCalendarEvent[] {
  const result = readFirstKvplResult(response);
  if (!Array.isArray(result)) {
    return [];
  }

  return result
    .map((record, index) => parseEmployeeCalendarEvent(record, employeeId, index))
    .filter((event): event is EmployeeCalendarEvent => event !== null);
}

function parseEmployeeCalendarEvent(record: unknown, employeeId: string, index: number): EmployeeCalendarEvent | null {
  const object = readObject(record);
  if (!object) {
    return null;
  }

  const range = readEventTimeRange(object);
  if (!range) {
    return null;
  }

  const sourceId = readStringId(object.id);
  const id = `employee-${employeeId}-${sourceId || 'event'}-${range.start}-${range.end}-${index}`;
  const title = readStringValue(object.name) || readStringValue(object.tooltip) || 'Мероприятие';
  const placeValue = readStringValue(object.place);
  const eventTypeId = readCalendarEventTypeId(object);
  const isBirthday = eventTypeId === birthdayCalendarEventTypeId;

  return {
    id,
    title,
    start: range.start,
    end: range.end,
    type: readEmployeeCalendarEventType(object),
    eventTypeId,
    allDay: range.allDay,
    place: placeValue || readStringValue(object.outerSource),
    birthdayEmployeeId: isBirthday ? readBirthdayEmployeeId(object) : '',
    birthdayEmployeeName: isBirthday ? readBirthdayEmployeeName(object) : ''
  };
}

function parseEmployeeWorkInfo(response: unknown): EmployeeWorkInfo {
  const result = readFirstKvplResult(response);
  if (!result || typeof result !== 'object') {
    return { schedule: null, birthdayDate: '' };
  }

  const fields = Array.isArray((result as { поля?: unknown }).поля) ? (result as { поля: unknown[] }).поля : [];
  const records = Array.isArray((result as { записи?: unknown }).записи) ? (result as { записи: unknown[] }).записи : [];
  const record = records.find((item): item is unknown[] => Array.isArray(item));
  if (!record) {
    return { schedule: null, birthdayDate: '' };
  }

  const workTimeIndex = fields.findIndex((field) => field === 'времяработы');
  const workModeIndex = fields.findIndex((field) => field === 'режимработы');
  const birthdayDateIndex = fields.findIndex((field) => field === 'датарождения');
  return {
    schedule: parseWorkScheduleValue(record[workTimeIndex]) ?? parseWorkScheduleValue(record[workModeIndex]),
    birthdayDate: readDatePart(record[birthdayDateIndex])
  };
}

function parseEmployeeAbsenceSchedule(response: unknown, employeeId: string, selectedDate: string): EmployeeAbsenceSchedule | null {
  const result = readFirstKvplResult(response);
  const record = readObject(result);
  if (!record) {
    return null;
  }

  const startDate = readDatePart(record.ДатНач ?? record.датНач ?? record.start ?? record.startDate);
  const endDate = readDatePart(record.ДатКнц ?? record.датКнц ?? record.end ?? record.endDate);
  if (!dateInInclusiveRange(selectedDate, startDate, endDate)) {
    return null;
  }

  const absenceKind = readNumberValue(record.ВидОтсутствия ?? record.видОтсутствия ?? record.absenceKind);
  const allDayAbsence = readNumberValue(record.ВесьДень ?? record.весьДень ?? record.allDay);
  const type: EmployeeAbsenceSchedule['type'] | null = absenceKind && absenceKind > 0
    ? 'vacation'
    : allDayAbsence && allDayAbsence > 0
      ? 'absence'
      : null;
  if (!type) {
    return null;
  }

  return {
    id: `employee-absence-${employeeId}-${selectedDate}-${type}`,
    title: type === 'vacation' ? 'Отпуск' : 'Отсутствие',
    start: '00:00',
    end: '23:59',
    type,
    allDay: true,
    place: 'График работы',
    displayTime: type === 'vacation' ? formatDateRangeLabel(startDate, endDate) : 'Весь день'
  };
}

function parseWorkScheduleValue(value: unknown): EmployeeWorkSchedule | null {
  const text = typeof value === 'number' && Number.isFinite(value)
    ? String(value).padStart(8, '0')
    : readStringValue(value);
  const clockRangeMatch = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(text);
  if (clockRangeMatch) {
    return normalizeWorkSchedule(
      `${clockRangeMatch[1].padStart(2, '0')}:${clockRangeMatch[2]}`,
      `${clockRangeMatch[3].padStart(2, '0')}:${clockRangeMatch[4]}`
    );
  }

  const compactRangeMatch = /^(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (compactRangeMatch) {
    return normalizeWorkSchedule(
      `${compactRangeMatch[1]}:${compactRangeMatch[2]}`,
      `${compactRangeMatch[3]}:${compactRangeMatch[4]}`
    );
  }

  return null;
}

function normalizeWorkSchedule(start: string, end: string): EmployeeWorkSchedule | null {
  const startMinutes = clockToMinutes(start);
  const endMinutes = clockToMinutes(end);
  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    return null;
  }

  return {
    start,
    end,
    label: `${start}-${end}`
  };
}

function readEmployeeCalendarEventType(record: Record<string, unknown>): EmployeeCalendarEventType {
  const type = typeof record.type === 'number' ? record.type : Number(record.type);
  if (type === absenceCalendarEventTypeId) {
    return 'absence';
  }

  const text = [
    readStringValue(record.name),
    readStringValue(record.tooltip),
    readStringValue(record.comment),
    readStringValue(record.color)
  ]
    .join(' ')
    .toLocaleLowerCase('ru-RU');

  if (text.includes('отпуск')) {
    return 'vacation';
  }
  if (text.includes('отсутств')) {
    return 'absence';
  }
  return 'event';
}

function readCalendarEventTypeId(record: Record<string, unknown>): number | null {
  const eventType = readNumberValue(record.eventtype ?? record.eventType ?? record.eventTypeId);
  const type = readNumberValue(record.type);
  if (eventType === birthdayCalendarEventTypeId || type === birthdayCalendarEventTypeId || isBirthdayCalendarEventRecord(record)) {
    return birthdayCalendarEventTypeId;
  }
  if (eventType !== null && Number.isInteger(eventType)) {
    return eventType;
  }

  return type === absenceCalendarEventTypeId ? absenceCalendarEventTypeId : null;
}

function isBirthdayCalendarEventRecord(record: Record<string, unknown>): boolean {
  const text = [
    readStringValue(record.name),
    readStringValue(record.tooltip),
    readStringValue(record.comment),
    readStringValue(record.color)
  ]
    .join(' ')
    .toLocaleLowerCase('ru-RU');

  return text.includes('день рождения') || text.includes('дни рождения') || text.includes('birthday');
}

function readBirthdayEmployeeId(record: Record<string, unknown>): string {
  const directKeys = [
    'employeeId',
    'employeeid',
    'employee_id',
    'employee',
    'personId',
    'personid',
    'person',
    'memberId',
    'memberid',
    'сотрудник',
    'сотрудникId',
    'сотрудникid',
    'сотрудникКод',
    'сотрудникНомерЗаписи',
    'номерЗаписиСотрудника',
    'номерзаписисотрудника'
  ];

  for (const key of directKeys) {
    const value = readStringId(record[key]);
    if (value && value !== '0') {
      return value;
    }
  }

  const employeeIds = readStringValue(record.employees)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));

  return employeeIds.length === 1 ? employeeIds[0] : '';
}

function readBirthdayEmployeeName(record: Record<string, unknown>): string {
  const directKeys = [
    'employeeName',
    'employeename',
    'personName',
    'personname',
    'memberName',
    'membername',
    'фио',
    'фиократко',
    'сотрудникФИО',
    'сотрудникфио',
    'сотрудникИмя',
    'именинник',
    'birthdayName',
    'birthdayname'
  ];

  for (const key of directKeys) {
    const value = readStringValue(record[key]);
    if (value) {
      return value;
    }
  }

  const title = readStringValue(record.tooltip) || readStringValue(record.name);
  const titleMatch = /^(?:день|дни)\s+рождения\s*[:\-–—]?\s*(.+)$/iu.exec(title);
  return titleMatch?.[1]?.trim() ?? '';
}

function readEventTimeRange(record: Record<string, unknown>): { start: string; end: string; allDay: boolean } | null {
  if (isAllDayCalendarEvent(record)) {
    return { start: '00:00', end: '23:59', allDay: true };
  }

  const period = readStringValue(record.period);
  const periodRange = /^(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(period);
  const start = readClockTime(record.start) || readClockTime(record.time) || (periodRange ? `${periodRange[1]}:${periodRange[2]}` : '');
  const end = readClockTime(record.end) || (periodRange ? `${periodRange[3]}:${periodRange[4]}` : '');

  return start && end ? { start, end, allDay: false } : null;
}

function isAllDayCalendarEvent(record: Record<string, unknown>): boolean {
  if (record.allDay === 1 || record.allDay === true || record.timed === false) {
    return true;
  }

  const startDate = readDatePart(record.start);
  const endDate = readDatePart(record.end);
  if (!startDate || !endDate || startDate !== endDate) {
    return false;
  }

  const startTime = readClockTime(record.start);
  const endTime = readClockTime(record.end);
  return (!startTime && !endTime) || (Boolean(startTime) && startTime === endTime);
}

function parseRoomAvailability(response: unknown): RoomAvailability[] {
  const result = readFirstKvplResult(response);
  if (!Array.isArray(result)) {
    return [];
  }

  return result
    .map((item) => {
      const itemObject = readObject(item);
      const record = readObject(itemObject?.record);
      const period = readObject(itemObject?.period);
      const id = readStringId(record?.id);
      const name = typeof record?.name === 'string' ? record.name.trim() : '';

      if (!id || !name) {
        return null;
      }

      const blocks = Object.entries(period ?? {})
        .map(([key, value]) => parseRoomBusyBlock(key, value, id, name))
        .filter((block): block is RoomBusyBlock => block !== null);

      return { id, name, blocks };
    })
    .filter((room): room is RoomAvailability => room !== null);
}

function parseRoomBusyBlock(key: string, value: unknown, placeId: string, placeName: string): RoomBusyBlock | null {
  const period = readObject(value);
  if (!period) {
    return null;
  }

  const type = typeof period.type === 'number' ? period.type : Number(period.type);
  if (type !== 1) {
    return null;
  }

  const start = readClockTime(period.start);
  const end = readClockTime(period.end);
  if (!start || !end) {
    return null;
  }

  const rowId = readStringId(period.row_id) || key.replace(/^:/, '');
  const title = typeof period.title === 'string' && period.title.trim() ? period.title.trim() : 'Занято';
  const author = typeof period.author === 'string' ? period.author.trim() : '';

  return {
    id: `room-${placeId}-${rowId}`,
    title,
    start,
    end,
    placeId,
    placeName,
    author
  };
}

function readFirstKvplResult(response: unknown): unknown {
  if (!response || typeof response !== 'object' || !('tasks' in response)) {
    return null;
  }
  const tasks = (response as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) {
    return null;
  }
  const firstTask = tasks[0];
  return firstTask && typeof firstTask === 'object' && 'result' in firstTask ? (firstTask as { result: unknown }).result : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readStringId(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function readNumberValue(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function readStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringField(record: unknown[], fields: unknown[], fieldName: string): string {
  const index = fields.findIndex((field) => field === fieldName);
  return index >= 0 ? readStringValue(record[index]) : '';
}

function buildPulseStorageUrl(value: unknown): string {
  const avatarPath = readStringValue(value);
  if (!avatarPath) {
    return '';
  }
  if (/^https?:\/\//i.test(avatarPath)) {
    return encodeURI(avatarPath);
  }
  return encodeURI(`${pulseStorageBaseUrl}${avatarPath.replace(/^\/+/, '')}`);
}

function normalizePulseColor(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
  const colorMap: Record<string, string> = {
    primary: 'var(--v-primary-base)',
    indigo: '#3f51b5',
    'indigo lighten-4': '#c5cae9',
    'indigo lighten4': '#c5cae9',
    'blue-grey': '#607d8b',
    'blue grey': '#607d8b',
    blue: '#2196f3',
    'blue lighten-5': '#e3f2fd',
    'blue lighten5': '#e3f2fd',
    amber: '#ffc107'
  };
  return (colorMap[normalized] ?? value.trim()) || 'var(--v-primary-base)';
}

function readDatePart(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? '';
}

function dateInInclusiveRange(value: string, start: string, end: string): boolean {
  if (!value || !start || !end) {
    return false;
  }
  return value >= start && value <= end;
}

function formatDateRangeLabel(start: string, end: string): string {
  const startLabel = formatDateLabel(start);
  const endLabel = formatDateLabel(end);
  if (!startLabel || !endLabel) {
    return 'Весь день';
  }
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function formatDateLabel(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : '';
}

function readClockTime(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const dateTimeMatch = /(?:T|\s)(\d{2}):(\d{2})/.exec(value);
  if (dateTimeMatch) {
    return `${dateTimeMatch[1]}:${dateTimeMatch[2]}`;
  }
  const plainMatch = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!plainMatch) {
    return '';
  }
  return `${plainMatch[1].padStart(2, '0')}:${plainMatch[2]}`;
}

function clockToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function workMonthForDate(value: string): string {
  const [year, month] = value.split('-');
  return `${year}-${month}-01T00:00:00.000`;
}

function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
