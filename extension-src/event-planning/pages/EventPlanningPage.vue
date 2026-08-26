<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  getActiveEmployees,
  getCalendarEventTypes,
  getCalendarFilters,
  getEmployeeAbsenceSchedule,
  getEmployeeCalendarEvents,
  getEmployeeProfile,
  getEmployeeWorkSchedule,
  getEventPlaces,
  getRoomAvailability
} from '@/api/pulse';
import type { ActiveEmployee, CalendarEventTypeDefinition, EmployeeProfile, EmployeeWorkSchedule } from '@/api/pulse';
import { getErrorMessage } from '@/api/http';
import PlanningDropdown from '@/components/PlanningDropdown.vue';

type BlockType = 'event' | 'absence' | 'vacation' | 'draft';
type ParticipantStatus = 'free' | 'busy' | 'away';
type TimelineHandle = 'start' | 'end';
type TimelineDragTarget = TimelineHandle | 'range';
type DisplayFilterKey = 'events' | 'absences' | 'vacations';
type CalendarPickerView = 'dates' | 'months' | 'years';

type CalendarDay = {
  key: string;
  label: number;
  value: string;
  currentMonth: boolean;
  today: boolean;
  selected: boolean;
  disabled: boolean;
};

type TimelineBlock = {
  id: string;
  title: string;
  start: string;
  end: string;
  type: BlockType;
  eventTypeId?: number | null;
  allDay?: boolean;
  displayTime?: string;
  place: string;
  birthdayEmployeeId?: string;
  birthdayEmployeeName?: string;
};

type Participant = {
  id: string;
  name: string;
  role: string;
  team: string;
  avatarUrl: string;
  status: ParticipantStatus;
  workload: number;
  blocks: TimelineBlock[];
  hasBirthday: boolean;
  eventsLoading: boolean;
  eventsError: string;
};

type TimelinePlaceRow = {
  id: string;
  name: string;
  blocks: TimelineBlock[];
};

type TimelineDisplayRow = {
  key: string;
  kind: 'place' | 'participant';
  id: string;
  name: string;
  avatarUrl: string;
  blocks: TimelineBlock[];
  hasBirthday: boolean;
  selected: boolean;
  loading: boolean;
  error: string;
  workSchedule: EmployeeWorkSchedule | null;
  workScheduleLoading: boolean;
  workScheduleError: string;
};

type TimelineLaidOutBlock = TimelineBlock & {
  lane: number;
};

type TimelineRowLayout = {
  blocks: TimelineLaidOutBlock[];
  laneCount: number;
  height: number;
};

type TimelineBlockRange = {
  start: number;
  end: number;
};

type PlanningUrlState = {
  date: string;
  participantIds: string[];
  duration: number | null;
  start: string;
  end: string;
  placeIds: string[];
  displayFilters: DisplayFilterKey[];
};

type EmployeeInfoCacheRecord = ActiveEmployee & {
  updatedAt: number;
};

type ParticipantEventsState = {
  blocks: TimelineBlock[];
  loading: boolean;
  loaded: boolean;
  error: string;
};

type ParticipantWorkScheduleState = {
  schedule: EmployeeWorkSchedule | null;
  birthdayDate: string;
  loading: boolean;
  loaded: boolean;
  error: string;
};

type EmployeeAvatarCacheEntry = {
  objectUrl: string;
  expiresAt: number;
  promise: Promise<void> | null;
};

const workStartMinutes = 7 * 60;
const workEndMinutes = 20 * 60;
const workDurationMinutes = workEndMinutes - workStartMinutes;
const timelineStartMinutes = workStartMinutes - 30;
const timelineEndMinutes = workEndMinutes + 30;
const timelineDurationMinutes = timelineEndMinutes - timelineStartMinutes;
const timelineGridStepMinutes = 30;
const timeStepMinutes = 15;
const minEventDurationMinutes = 15;
const maxEventDurationMinutes = 9 * 60;
const participantPageSize = 50;
const employeeAvatarCacheTtlMs = 2 * 60 * 1000;
const timelineHourWidth = 82;
const timelineHandleMinWidthPx = 54;
const timelineHandleMinGapPx = 4;
const timelineHandleMinCenterGapPx = timelineHandleMinWidthPx + timelineHandleMinGapPx;
const timelineRowMinHeightPx = 54;
const timelineBlockHeightPx = 38;
const timelineBlockLaneGapPx = 4;
const timelineBlockVerticalPaddingPx = 8;
const birthdayEventTypeId = 2;
const durationItems = [
  ...Array.from({ length: (maxEventDurationMinutes - minEventDurationMinutes) / timeStepMinutes + 1 }, (_, index) => {
    const minutes = minEventDurationMinutes + index * timeStepMinutes;
    return { title: formatDurationLabel(minutes), value: minutes };
  }),
  { title: 'Весь день', value: workDurationMinutes }
];
const displayFilterItems: Array<{ value: DisplayFilterKey; title: string }> = [
  { value: 'events', title: 'Мероприятия' },
  { value: 'absences', title: 'Отсутствие' },
  { value: 'vacations', title: 'Отпуск' }
];
const allDisplayFilterValues = displayFilterItems.map((item) => item.value);
const planningUrlParamNames = ['date', 'participants', 'duration', 'start', 'end', 'places', 'show'];
const employeeInfoCacheStorageKey = 'trickPlus.eventPlanning.employeeInfoCache.v1';
const calendarWeekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const calendarMonthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long' });
const calendarTitleDateFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
const calendarMonthNames = Array.from({ length: 12 }, (_, index) =>
  capitalize(calendarMonthFormatter.format(new Date(2026, index, 1)))
);
const firstTimelineHour = Math.ceil(timelineStartMinutes / 60);
const lastTimelineHour = Math.floor(timelineEndMinutes / 60);
const hourColumns = Array.from({ length: lastTimelineHour - firstTimelineHour + 1 }, (_, index) => firstTimelineHour + index);
const timelineTrackMinWidth = hourColumns.length * timelineHourWidth;
const gridLines = Array.from(
  { length: timelineDurationMinutes / timelineGridStepMinutes - 1 },
  (_, index) => (((index + 1) * timelineGridStepMinutes) / timelineDurationMinutes) * 100
);
const timelineGridStyle = {
  '--hour-count': String(hourColumns.length),
  '--timeline-track-min-width': `${timelineTrackMinWidth}px`
};
let timelineDragLayer: HTMLElement | null = null;
let timelineRangeDragOffsetMinutes = 0;
let timelineRangeDragDurationMinutes = minEventDurationMinutes;
let timelineHandleDragStartMinutes = 0;
let timelineHandleDragStartClientX = 0;
let timelineHandleDragLayerWidth = timelineTrackMinWidth;
let timelineCursorLockClass: 'timeline-dragging-range' | 'timeline-dragging-resize' | null = null;
let timelineScrollSyncFrame = 0;
let timelineScrollSyncSource: 'header' | 'body' | null = null;
let timelineScaleLayerResizeObserver: ResizeObserver | null = null;
let todayDateUpdateTimeout = 0;
let currentTimeUpdateTimeout = 0;
let planningUrlSyncTimeout = 0;
const timelineScaleLayer = ref<HTMLElement | null>(null);
const timelineScaleLayerWidth = ref(timelineTrackMinWidth);
const timelineHeaderScroll = ref<HTMLElement | null>(null);
const timelineBodyScroll = ref<HTMLElement | null>(null);
const currentTimeMinutes = ref(readCurrentClockMinutes());
const queryClient = useQueryClient();
const currentPulseUser = readCurrentPulseUser();
const initialEmployeeInfoCache = readEmployeeInfoCache();
const initialPlanningUrlState = readPlanningUrlState();
const employeeAvatarCache = new Map<string, EmployeeAvatarCacheEntry>();
const employeeInfoRefreshRequestedIds = new Set<string>();
const employeeInfoRefreshInFlightIds = new Set<string>();
let employeeAvatarCacheCleanupTimer = 0;

const participants = ref<Participant[]>([
  {
    id: '423',
    name: 'Чуриков Александр',
    role: 'Архитектор',
    team: 'Платформа',
    avatarUrl: '',
    status: 'busy',
    workload: 68,
    hasBirthday: false,
    eventsLoading: false,
    eventsError: '',
    blocks: [
      { id: 'e-423-1', title: 'Технический совет', start: '10:00', end: '11:30', type: 'event', place: 'Онлайн' },
      { id: 'e-423-2', title: 'Согласование API', start: '15:30', end: '17:00', type: 'event', place: 'Большая переговорная' }
    ]
  },
  {
    id: '472',
    name: 'Медведева Нина',
    role: 'Аналитик',
    team: 'МП ФЛ',
    avatarUrl: '',
    status: 'away',
    workload: 35,
    hasBirthday: false,
    eventsLoading: false,
    eventsError: '',
    blocks: [
      { id: 'a-472-1', title: 'Отсутствие', start: '08:00', end: '13:00', type: 'absence', place: 'График работы' },
      { id: 'e-472-1', title: 'Планерка продукта', start: '14:00', end: '15:00', type: 'event', place: 'Проектная комната' }
    ]
  },
  {
    id: '549',
    name: 'Егоров Евгений',
    role: 'Разработчик',
    team: 'Интеграции',
    avatarUrl: '',
    status: 'busy',
    workload: 52,
    hasBirthday: false,
    eventsLoading: false,
    eventsError: '',
    blocks: [
      { id: 'e-549-1', title: 'Демо заказчику', start: '11:00', end: '12:00', type: 'event', place: 'Онлайн' },
      { id: 'e-549-2', title: 'Разбор задач', start: '16:00', end: '18:00', type: 'event', place: 'Онлайн' }
    ]
  },
  {
    id: '342',
    name: 'Кузнецова Мария',
    role: 'Руководитель проекта',
    team: 'CRM',
    avatarUrl: '',
    status: 'away',
    workload: 26,
    hasBirthday: false,
    eventsLoading: false,
    eventsError: '',
    blocks: [{ id: 'v-342-1', title: 'Отпуск', start: '08:00', end: '19:00', type: 'vacation', place: 'График отпусков' }]
  },
  {
    id: '418',
    name: 'Леминчук Дмитрий',
    role: 'Тестировщик',
    team: 'Качество',
    avatarUrl: '',
    status: 'free',
    workload: 18,
    hasBirthday: false,
    eventsLoading: false,
    eventsError: '',
    blocks: [{ id: 'e-418-1', title: 'Регресс', start: '13:30', end: '14:30', type: 'event', place: 'Проектная комната' }]
  }
]);

const selectedDate = ref(initialPlanningUrlState.date || formatInputDate(new Date()));
const todayDateValue = ref(formatInputDate(new Date()));
const dateMenu = ref(false);
const datePickerMonth = ref(startOfMonth(parseInputDate(selectedDate.value)));
const datePickerView = ref<CalendarPickerView>('dates');
const datePickerTransitionName = ref('planning-calendar-view-transition');
const initialParticipantId = participants.value[0]?.id ?? '';
const currentUserParticipantId = computed(() => currentPulseUser.employeeId || initialParticipantId);
const currentUserParticipantNameFallback = computed(() => currentPulseUser.displayName || currentUserParticipantId.value);
const defaultParticipantIds = computed(() => (currentUserParticipantId.value ? [currentUserParticipantId.value] : []));
const initialVisibleParticipantIds = initialPlanningUrlState.participantIds.length
  ? [...initialPlanningUrlState.participantIds]
  : [...defaultParticipantIds.value];
const selectedParticipantId = ref(initialVisibleParticipantIds[0] ?? currentUserParticipantId.value);
const selectedParticipantIds = ref<string[]>([]);
const visibleParticipantIds = ref<string[]>(initialVisibleParticipantIds);
const selectedBlockId = ref<string | null>(null);
const initialDisplayFilters = new Set(initialPlanningUrlState.displayFilters);
const showEvents = ref(initialDisplayFilters.has('events'));
const showAbsences = ref(initialDisplayFilters.has('absences'));
const showVacations = ref(initialDisplayFilters.has('vacations'));
const eventDuration = ref<number | null>(initialPlanningUrlState.duration);
const selectedPlaceIds = ref<string[]>([...initialPlanningUrlState.placeIds]);
const activeTimelineHandle = ref<TimelineDragTarget | null>(null);
const participantEventsByKey = ref<Record<string, ParticipantEventsState>>({});
const participantWorkSchedulesById = ref<Record<string, ParticipantWorkScheduleState>>({});
const participantSearch = ref('');
const displayedActiveEmployeeItems = ref<ActiveEmployee[]>(Object.values(initialEmployeeInfoCache));
const knownActiveEmployeesById = ref<Record<string, ActiveEmployee>>(
  createInitialKnownActiveEmployees(initialPlanningUrlState.participantIds)
);
const employeeAvatarCacheRevision = ref(0);

const eventForm = reactive({
  title: 'Новая встреча',
  participantId: selectedParticipantId.value,
  start: initialPlanningUrlState.start,
  end: initialPlanningUrlState.end,
  place: 'Онлайн'
});

const calendarFilters = useQuery({
  queryKey: ['planning-calendar-filters'],
  queryFn: getCalendarFilters,
  retry: false,
  staleTime: 5 * 60 * 1000
});

const calendarEventTypes = useQuery({
  queryKey: ['planning-calendar-event-types'],
  queryFn: () => getCalendarEventTypes({ date: selectedDate.value }),
  retry: false,
  staleTime: 30 * 60 * 1000
});

const eventPlaces = useQuery({
  queryKey: ['planning-event-places'],
  queryFn: () => getEventPlaces(),
  retry: false,
  staleTime: 5 * 60 * 1000
});

const roomAvailability = useQuery({
  queryKey: computed(() => ['planning-room-availability', selectedDate.value]),
  queryFn: () => getRoomAvailability({ filter: buildRoomAvailabilityFilter(selectedDate.value) }),
  enabled: computed(() => selectedPlaceIds.value.length > 0),
  retry: false,
  staleTime: 30 * 1000
});

const currentEmployee = useQuery({
  queryKey: computed(() => ['planning-current-employee', currentUserParticipantId.value]),
  queryFn: () => getEmployeeProfile(currentUserParticipantId.value),
  enabled: computed(() => Boolean(currentUserParticipantId.value)),
  retry: false,
  staleTime: 5 * 60 * 1000
});

const activeEmployees = useInfiniteQuery({
  queryKey: computed(() => ['planning-active-employees', participantSearch.value.trim()]),
  queryFn: ({ pageParam }) =>
    getActiveEmployees({
      pageSize: participantPageSize,
      pageOffset: typeof pageParam === 'number' ? pageParam : 0,
      search: participantSearch.value
    }),
  initialPageParam: 0,
  getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextOffset : undefined),
  retry: false,
  staleTime: 5 * 60 * 1000
});

const currentUserParticipantName = computed(
  () => currentEmployee.data.value?.name || currentUserParticipantNameFallback.value
);

const pulseErrorMessage = computed(() => {
  const failedRequest = [
    { title: 'Фильтры календаря', error: calendarFilters.error.value },
    { title: 'Типы событий', error: calendarEventTypes.error.value },
    { title: 'Места проведения', error: eventPlaces.error.value },
    { title: 'Занятость переговорок', error: selectedPlaceIds.value.length > 0 ? roomAvailability.error.value : null },
    { title: 'Профиль текущего сотрудника', error: currentEmployee.error.value },
    { title: 'Список сотрудников', error: activeEmployees.error.value }
  ].find((item) => item.error);

  if (!failedRequest) {
    return participantRowsErrorMessage.value;
  }
  return `${failedRequest.title}: ${getErrorMessage(failedRequest.error, 'не удалось загрузить данные')}`;
});

const participantRowsErrorMessage = computed(() => {
  const row = visibleTimelineRows.value.find((item) => item.error);
  if (!row) {
    return '';
  }
  return row.kind === 'participant' ? `Данные сотрудника ${row.name}: ${row.error}` : row.error;
});

const loadedActiveEmployeeItems = computed(() => {
  const employees = activeEmployees.data.value?.pages.flatMap((page) => page.items) ?? [];
  const seenIds = new Set<string>();
  const items = employees.filter((employee) => {
    if (seenIds.has(employee.id)) {
      return false;
    }
    seenIds.add(employee.id);
    return true;
  });
  const currentUserId = currentUserParticipantId.value;
  if (currentUserId && !seenIds.has(currentUserId)) {
    const currentEmployeeProfile = currentEmployee.data.value;
    return [
      {
        id: currentUserId,
        name: currentEmployeeProfile?.name ?? currentUserParticipantName.value,
        fullName: currentEmployeeProfile?.name ?? currentUserParticipantName.value,
        avatarUrl: currentEmployeeProfile?.avatarUrl ?? '',
        status: null,
        statusText: ''
      },
      ...items
    ];
  }
  return items;
});
const activeEmployeeItems = computed(() =>
  activeEmployees.data.value ? loadedActiveEmployeeItems.value : displayedActiveEmployeeItems.value
);
const activeEmployeeById = computed(() => {
  const entries = [
    ...activeEmployeeItems.value,
    ...Object.values(knownActiveEmployeesById.value)
  ].map((employee) => [employee.id, employee] as const);
  return new Map(entries);
});
const employeeAvatarSourceUrls = computed(() => {
  const urls = [
    currentEmployee.data.value?.avatarUrl ?? '',
    ...participants.value.map((participant) => participant.avatarUrl),
    ...Object.values(knownActiveEmployeesById.value).map((employee) => employee.avatarUrl),
    ...activeEmployeeItems.value.map((employee) => employee.avatarUrl)
  ].filter(Boolean);
  return [...new Set(urls)];
});
const participantById = computed(() => new Map(participants.value.map((participant) => [participant.id, participant])));
const participantSelectItems = computed(() => {
  const employeesById = new Map<string, ActiveEmployee>();
  for (const employee of activeEmployeeItems.value) {
    employeesById.set(employee.id, employee);
  }
  for (const participantId of [...visibleParticipantIds.value, ...selectedParticipantIds.value]) {
    const employee = activeEmployeeById.value.get(participantId);
    if (employee) {
      employeesById.set(employee.id, employee);
    }
  }
  return [...employeesById.values()].map((employee) => ({
    title: employee.name,
    value: employee.id,
    avatarUrl: cachedEmployeeAvatarUrl(employee.avatarUrl)
  }));
});
const participantFilterHasMore = computed(() => Boolean(activeEmployees.hasNextPage.value));
const participantFilterLoading = computed(() => activeEmployees.isFetching.value && !activeEmployees.isFetchingNextPage.value);
const participantFilterLoadingMore = computed(() => activeEmployees.isFetchingNextPage.value);
const visibleTimelineParticipants = computed<Participant[]>(() =>
  visibleParticipantIds.value
    .map((participantId) => {
      const employee = activeEmployeeById.value.get(participantId);
      const fallback = participantById.value.get(participantId);
      const name = employee?.name ?? fallback?.name ?? '';
      const fullName = employee?.fullName || employee?.name || fallback?.name || name;
      const eventsState = readParticipantEventsState(participantId);
      const workScheduleState = readParticipantWorkScheduleState(participantId);
      if (!name) {
        return null;
      }
      return {
        id: participantId,
        name,
        avatarUrl: cachedEmployeeAvatarUrl(employee?.avatarUrl ?? fallback?.avatarUrl ?? ''),
        role: '',
        team: '',
        status: participantStatusFromBlocks(eventsState.blocks, fallback?.status ?? 'free'),
        workload: fallback?.workload ?? 0,
        blocks: eventsState.blocks,
        hasBirthday: isBirthdayDateOnSelectedDate(workScheduleState.birthdayDate)
          || eventsState.blocks.some((block) => isParticipantBirthdayBlock(block, participantId, fullName)),
        eventsLoading: eventsState.loading || workScheduleState.loading,
        eventsError: [eventsState.error, workScheduleState.error].filter(Boolean).join('; ')
      };
    })
    .filter((participant): participant is Participant => participant !== null)
);
const eventPlaceById = computed(() => new Map((eventPlaces.data.value ?? []).map((place) => [place.id, place])));
const roomAvailabilityById = computed(() => new Map((roomAvailability.data.value ?? []).map((room) => [room.id, room])));
const calendarEventTypeById = computed(() => new Map((calendarEventTypes.data.value ?? []).map((eventType) => [eventType.id, eventType])));
const placeSelectItems = computed(() => (eventPlaces.data.value ?? []).map((place) => ({ title: place.title, value: place.id })));
const selectedPlaceRows = computed<TimelinePlaceRow[]>(() =>
  selectedPlaceIds.value
    .map((placeId) => {
      const place = eventPlaceById.value.get(placeId);
      const room = roomAvailabilityById.value.get(placeId);
      const name = place?.title ?? room?.name ?? '';
      if (!name) {
        return null;
      }
      return {
        id: placeId,
        name,
        blocks: (room?.blocks ?? []).map((block) => ({
          id: block.id,
          title: block.title,
          start: block.start,
          end: block.end,
          type: 'event',
          place: block.placeName
        }))
      };
    })
    .filter((place): place is TimelinePlaceRow => place !== null)
);
const visibleTimelineRows = computed<TimelineDisplayRow[]>(() => [
  ...selectedPlaceRows.value.map((place) => ({
    key: `place-${place.id}`,
    kind: 'place' as const,
    id: place.id,
    name: place.name,
    avatarUrl: '',
    blocks: place.blocks,
    hasBirthday: false,
    selected: false,
    loading: false,
    error: '',
    workSchedule: null,
    workScheduleLoading: false,
    workScheduleError: ''
  })),
  ...visibleTimelineParticipants.value.map((participant) => {
    const workScheduleState = readParticipantWorkScheduleState(participant.id);
    return {
      key: `participant-${participant.id}`,
      kind: 'participant' as const,
      id: participant.id,
      name: participant.name,
      avatarUrl: participant.avatarUrl ?? '',
      blocks: participant.blocks,
      hasBirthday: participant.hasBirthday,
      selected: selectedParticipantIds.value.includes(participant.id),
      loading: Boolean(participant.eventsLoading),
      error: participant.eventsError ?? '',
      workSchedule: workScheduleState.schedule,
      workScheduleLoading: workScheduleState.loading,
      workScheduleError: workScheduleState.error
    };
  })
]);
const timelineRowLayouts = computed(() => {
  const layouts = new Map<string, TimelineRowLayout>();
  for (const row of visibleTimelineRows.value) {
    layouts.set(row.key, buildTimelineRowLayout(row));
  }
  return layouts;
});
const timelineRowsGridStyle = computed(() => ({
  gridTemplateRows: visibleTimelineRows.value
    .map((row) => `${timelineRowLayout(row).height}px`)
    .join(' ')
}));

const selectedDateTitle = computed(() => formatDisplayDate(selectedDate.value));
const datePickerYearTitle = computed(() => String(datePickerMonth.value.getFullYear()));
const datePickerDateTitle = computed(() => formatCalendarTitleDate(selectedDate.value));
const datePickerMonthTitle = computed(() => capitalize(calendarMonthFormatter.format(datePickerMonth.value)));
const datePickerViewKey = computed(() => (
  `${datePickerView.value}-${datePickerMonth.value.getFullYear()}-${datePickerMonth.value.getMonth()}`
));
const todayDateTitle = computed(() => formatDisplayDate(todayDateValue.value));
const currentTimeVisible = computed(() => (
  selectedDate.value === todayDateValue.value
  && currentTimeMinutes.value >= timelineStartMinutes
  && currentTimeMinutes.value <= timelineEndMinutes
));
const currentTimeLineStyle = computed(() => ({
  left: `${minutesToTimelinePercent(currentTimeMinutes.value)}%`
}));
const datePickerMonthItems = computed(() =>
  calendarMonthNames.map((label, index) => ({
    index,
    label,
    selected: index === datePickerMonth.value.getMonth()
  }))
);
const datePickerYearItems = computed(() => {
  const centerYear = datePickerMonth.value.getFullYear();
  const startYear = centerYear - 4;
  return Array.from({ length: 9 }, (_, index) => startYear + index);
});
const datePickerRows = computed(() => {
  const rows: CalendarDay[][] = [];
  const month = datePickerMonth.value;
  const start = calendarGridStart(month);

  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const row: CalendarDay[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = new Date(start.getTime());
      date.setDate(start.getDate() + weekIndex * 7 + dayIndex);
      const value = formatInputDate(date);
      const currentMonth = date.getMonth() === month.getMonth();
      row.push({
        key: `${weekIndex}-${dayIndex}-${value}`,
        label: date.getDate(),
        value,
        currentMonth,
        today: value === todayDateValue.value,
        selected: value === selectedDate.value,
        disabled: !currentMonth
      });
    }
    rows.push(row);
  }

  return rows;
});
const hasEventDuration = computed(() => eventDuration.value !== null);
const visibleDisplayFilters = computed<DisplayFilterKey[]>({
  get: () => {
    const values: DisplayFilterKey[] = [];
    if (showEvents.value) {
      values.push('events');
    }
    if (showAbsences.value) {
      values.push('absences');
    }
    if (showVacations.value) {
      values.push('vacations');
    }
    return values;
  },
  set: (values) => {
    showEvents.value = values.includes('events');
    showAbsences.value = values.includes('absences');
    showVacations.value = values.includes('vacations');
  }
});

const selectedIntervalStartMinutes = computed(() => timeToMinutes(eventForm.start));
const selectedIntervalEndMinutes = computed(() => timeToMinutes(eventForm.end));

const selectedIntervalConflictCoverage = computed(() => {
  const start = selectedIntervalStartMinutes.value;
  const end = selectedIntervalEndMinutes.value;
  const hasOfftimeOverlap = visibleTimelineRows.value.some((row) => {
    if (row.kind !== 'participant' || !row.workSchedule) {
      return false;
    }
    const scheduleStart = clamp(timeToMinutes(row.workSchedule.start), workStartMinutes, workEndMinutes);
    const scheduleEnd = clamp(timeToMinutes(row.workSchedule.end), workStartMinutes, workEndMinutes);
    return (
      intervalsOverlap(start, end, workStartMinutes, scheduleStart) ||
      intervalsOverlap(start, end, scheduleEnd, workEndMinutes)
    );
  });
  const intersections = [...selectedPlaceRows.value, ...visibleTimelineParticipants.value]
    .flatMap((row) => row.blocks)
    .filter((block) => block.type !== 'draft' && !isBirthdayBlock(block))
    .map((block) => ({
      start: Math.max(start, timeToMinutes(block.start)),
      end: Math.min(end, timeToMinutes(block.end))
    }))
    .filter((range) => range.start < range.end)
    .sort((left, right) => left.start - right.start);

  if (intersections.length === 0) {
    return { hasConflicts: hasOfftimeOverlap, fullyCovered: false };
  }

  let coveredUntil = start;
  for (const range of intersections) {
    if (range.start > coveredUntil) {
      return { hasConflicts: true, fullyCovered: false };
    }
    coveredUntil = Math.max(coveredUntil, range.end);
    if (coveredUntil >= end) {
      return { hasConflicts: true, fullyCovered: true };
    }
  }

  return { hasConflicts: true, fullyCovered: coveredUntil >= end };
});

const selectedIntervalStateClass = computed(() => {
  if (!selectedIntervalConflictCoverage.value.hasConflicts) {
    return 'selection-free';
  }
  return selectedIntervalConflictCoverage.value.fullyCovered ? 'selection-conflict' : 'selection-partial';
});

const selectedIntervalStyle = computed(() => {
  const start = Math.min(selectedIntervalStartMinutes.value, selectedIntervalEndMinutes.value);
  const end = Math.max(selectedIntervalStartMinutes.value, selectedIntervalEndMinutes.value);
  return {
    left: `${minutesToTimelinePercent(start)}%`,
    width: `${Math.max(minutesToTimelinePercent(end) - minutesToTimelinePercent(start), 0)}%`
  };
});

const selectedIntervalStartStyle = computed(() => ({
  left: `calc(${minutesToTimelinePercent(selectedIntervalStartMinutes.value)}% + 1px)`
}));

const selectedIntervalEndStyle = computed(() => ({
  left: `calc(${minutesToTimelinePercent(selectedIntervalEndMinutes.value)}% + 1px)`
}));

const timelineLockedStartPercent = minutesToTimelinePercent(workStartMinutes);
const timelineLockedEndPercent = minutesToTimelinePercent(workEndMinutes);
const timelineLockedStartStyle = timelineShadeStyle(0, timelineLockedStartPercent, `calc(${timelineLockedStartPercent}% + 1px)`);
const timelineLockedEndStyle = timelineShadeStyle(timelineLockedEndPercent, 100 - timelineLockedEndPercent);

const selectedIntervalStartHandleStyle = computed(() => selectedIntervalHandleStyle('start'));
const selectedIntervalEndHandleStyle = computed(() => selectedIntervalHandleStyle('end'));

watch(eventDuration, (duration) => {
  if (duration !== null) {
    applyDurationToEventForm(duration);
  }
});

watch(selectedPlaceIds, (placeIds) => {
  const placeTitles = placeIds
    .map((placeId) => eventPlaceById.value.get(placeId)?.title)
    .filter((title): title is string => Boolean(title));
  eventForm.place = placeTitles.length > 0 ? placeTitles.join(', ') : 'Онлайн';
});

watch(dateMenu, (open) => {
  if (open) {
    datePickerMonth.value = startOfMonth(parseInputDate(selectedDate.value));
    datePickerView.value = 'dates';
  }
});

watch(selectedDate, (value) => {
  if (!dateMenu.value) {
    datePickerMonth.value = startOfMonth(parseInputDate(value));
  }
});

watch(
  loadedActiveEmployeeItems,
  (items) => {
    if (!activeEmployees.data.value) {
      return;
    }
    displayedActiveEmployeeItems.value = items;
    rememberActiveEmployees(items);
  },
  { immediate: true }
);

watch(
  currentEmployee.data,
  (profile) => {
    rememberEmployeeProfile(profile);
  },
  { immediate: true }
);

watch(
  employeeAvatarSourceUrls,
  (urls) => {
    preloadEmployeeAvatars(urls);
  },
  { immediate: true }
);

watch(
  () => ({
    date: selectedDate.value,
    participantIds: [...visibleParticipantIds.value]
  }),
  ({ date, participantIds }) => {
    loadParticipantEventsForRows(date, participantIds);
    loadParticipantWorkSchedulesForRows(date, participantIds);
  },
  { immediate: true }
);

watch(
  () => [...visibleParticipantIds.value],
  (participantIds) => {
    refreshVisibleEmployeeInfo(participantIds);
  },
  { immediate: true }
);

watch(
  currentUserParticipantId,
  (participantId, previousParticipantId) => {
    if (!participantId) {
      return;
    }

    const previousDefault = previousParticipantId ? [previousParticipantId] : [];
    const visibleWasDefault =
      visibleParticipantIds.value.length === 0 ||
      (visibleParticipantIds.value.length === previousDefault.length &&
        visibleParticipantIds.value.every((id, index) => id === previousDefault[index]));
    if (visibleWasDefault) {
      visibleParticipantIds.value = [participantId];
    }

    if (!selectedParticipantId.value || selectedParticipantId.value === previousParticipantId) {
      setPrimaryParticipant(participantId);
    }
  },
  { immediate: true }
);

watch(
  () => ({
    date: selectedDate.value,
    participantIds: [...visibleParticipantIds.value],
    duration: eventDuration.value,
    start: eventForm.start,
    end: eventForm.end,
    placeIds: [...selectedPlaceIds.value],
    displayFilters: [...visibleDisplayFilters.value]
  }),
  () => {
    schedulePlanningUrlSync();
  },
  { deep: true, immediate: true }
);

onMounted(() => {
  syncTodayDate();
  syncCurrentTime();
  window.addEventListener('focus', syncTodayDate);
  window.addEventListener('focus', syncCurrentTime);
  document.addEventListener('visibilitychange', syncTodayDateOnVisibilityChange);
  document.addEventListener('visibilitychange', syncCurrentTimeOnVisibilityChange);
  document.addEventListener('click', clearSelectedBlockOutsideTimeline);
  document.addEventListener('pointerdown', handlePlanningButtonPointerDown, true);
  updateTimelineScaleLayerWidth();
  const layer = timelineScaleLayer.value;
  if (!layer) {
    window.addEventListener('resize', updateTimelineScaleLayerWidth);
    return;
  }
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', updateTimelineScaleLayerWidth);
    return;
  }
  timelineScaleLayerResizeObserver = new ResizeObserver(updateTimelineScaleLayerWidth);
  timelineScaleLayerResizeObserver.observe(layer);
});

onBeforeUnmount(() => {
  if (todayDateUpdateTimeout) {
    window.clearTimeout(todayDateUpdateTimeout);
    todayDateUpdateTimeout = 0;
  }
  if (currentTimeUpdateTimeout) {
    window.clearTimeout(currentTimeUpdateTimeout);
    currentTimeUpdateTimeout = 0;
  }
  if (planningUrlSyncTimeout) {
    window.clearTimeout(planningUrlSyncTimeout);
    planningUrlSyncTimeout = 0;
  }
  clearEmployeeAvatarCache();
  if (timelineScrollSyncFrame) {
    window.cancelAnimationFrame(timelineScrollSyncFrame);
    timelineScrollSyncFrame = 0;
  }
  timelineScaleLayerResizeObserver?.disconnect();
  timelineScaleLayerResizeObserver = null;
  window.removeEventListener('focus', syncTodayDate);
  window.removeEventListener('focus', syncCurrentTime);
  document.removeEventListener('visibilitychange', syncTodayDateOnVisibilityChange);
  document.removeEventListener('visibilitychange', syncCurrentTimeOnVisibilityChange);
  document.removeEventListener('click', clearSelectedBlockOutsideTimeline);
  document.removeEventListener('pointerdown', handlePlanningButtonPointerDown, true);
  window.removeEventListener('resize', updateTimelineScaleLayerWidth);
  timelineScrollSyncSource = null;
  stopTimelineDrag();
});

function participantEventsKey(participantId: string, date = selectedDate.value): string {
  return `${date}:${participantId}`;
}

function readParticipantEventsState(participantId: string, date = selectedDate.value): ParticipantEventsState {
  return participantEventsByKey.value[participantEventsKey(participantId, date)] ?? {
    blocks: [],
    loading: false,
    loaded: false,
    error: ''
  };
}

function readParticipantWorkScheduleState(participantId: string): ParticipantWorkScheduleState {
  return participantWorkSchedulesById.value[participantId] ?? {
    schedule: null,
    birthdayDate: '',
    loading: false,
    loaded: false,
    error: ''
  };
}

function setParticipantEventsState(date: string, participantId: string, patch: Partial<ParticipantEventsState>): void {
  const key = participantEventsKey(participantId, date);
  const previous = readParticipantEventsState(participantId, date);
  participantEventsByKey.value = {
    ...participantEventsByKey.value,
    [key]: {
      ...previous,
      ...patch
    }
  };
}

function setParticipantWorkScheduleState(participantId: string, patch: Partial<ParticipantWorkScheduleState>): void {
  const previous = readParticipantWorkScheduleState(participantId);
  participantWorkSchedulesById.value = {
    ...participantWorkSchedulesById.value,
    [participantId]: {
      ...previous,
      ...patch
    }
  };
}

function normalizeParticipantEventId(value: string): string {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0 ? trimmed : '';
}

function mergeAbsenceScheduleBlocks(eventBlocks: TimelineBlock[], scheduleBlocks: TimelineBlock[]): TimelineBlock[] {
  if (scheduleBlocks.length === 0) {
    return eventBlocks;
  }

  const calendarBlocks = eventBlocks.filter((block) => block.type !== 'absence' && block.type !== 'vacation');
  return [...calendarBlocks, ...scheduleBlocks];
}

function loadParticipantEventsForRows(date: string, participantIds: string[]): void {
  const uniqueParticipantIds = [...new Set(participantIds)];
  for (const participantId of uniqueParticipantIds) {
    const employeeId = normalizeParticipantEventId(participantId);
    if (!employeeId) {
      setParticipantEventsState(date, participantId, {
        blocks: [],
        loading: false,
        loaded: true,
        error: `Некорректный идентификатор сотрудника: ${participantId}`
      });
      continue;
    }

    const currentState = readParticipantEventsState(participantId, date);
    if (currentState.loading || currentState.loaded) {
      continue;
    }

    setParticipantEventsState(date, participantId, {
      blocks: [],
      loading: true,
      error: ''
    });

    void Promise.allSettled([
      getEmployeeCalendarEvents({ employeeId, date }),
      getEmployeeAbsenceSchedule({ employeeId, date })
    ])
      .then(([eventsResult, absenceResult]) => {
        const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
        const absenceSchedule = absenceResult.status === 'fulfilled' ? absenceResult.value : null;
        const errors = [
          eventsResult.status === 'rejected'
            ? `события: ${getErrorMessage(eventsResult.reason, 'не удалось загрузить события')}`
            : '',
          absenceResult.status === 'rejected'
            ? `отсутствие/отпуск: ${getErrorMessage(absenceResult.reason, 'не удалось загрузить отсутствие или отпуск')}`
            : ''
        ].filter(Boolean);
        const scheduleBlocks: TimelineBlock[] = absenceSchedule
          ? [
              {
                id: absenceSchedule.id,
                title: absenceSchedule.title,
                start: absenceSchedule.start,
                end: absenceSchedule.end,
                type: absenceSchedule.type,
                eventTypeId: null,
                allDay: absenceSchedule.allDay,
                displayTime: absenceSchedule.displayTime,
                place: absenceSchedule.place
              }
            ]
          : [];
        const eventBlocks: TimelineBlock[] = events.map((event) => ({
          id: `employee-${employeeId}-${event.id}`,
          title: event.title,
          start: event.start,
          end: event.end,
          type: event.type,
          eventTypeId: event.eventTypeId,
          allDay: event.allDay,
          displayTime: event.displayTime,
          place: event.place,
          birthdayEmployeeId: event.birthdayEmployeeId,
          birthdayEmployeeName: event.birthdayEmployeeName
        }));

        setParticipantEventsState(date, participantId, {
          blocks: mergeAbsenceScheduleBlocks(eventBlocks, scheduleBlocks),
          loading: false,
          loaded: true,
          error: errors.join('; ')
        });
      });
  }
}

function loadParticipantWorkSchedulesForRows(date: string, participantIds: string[]): void {
  const uniqueParticipantIds = [...new Set(participantIds)];
  for (const participantId of uniqueParticipantIds) {
    const employeeId = normalizeParticipantEventId(participantId);
    if (!employeeId) {
      setParticipantWorkScheduleState(participantId, {
        schedule: null,
        birthdayDate: '',
        loading: false,
        loaded: true,
        error: `Некорректный идентификатор сотрудника: ${participantId}`
      });
      continue;
    }

    const currentState = readParticipantWorkScheduleState(participantId);
    if (currentState.loading || currentState.loaded) {
      continue;
    }

    setParticipantWorkScheduleState(participantId, {
      schedule: null,
      birthdayDate: '',
      loading: true,
      error: ''
    });

    void getEmployeeWorkSchedule({ employeeId, date })
      .then((workInfo) => {
        setParticipantWorkScheduleState(participantId, {
          schedule: workInfo.schedule,
          birthdayDate: workInfo.birthdayDate,
          loading: false,
          loaded: true,
          error: ''
        });
      })
      .catch((error: unknown) => {
        setParticipantWorkScheduleState(participantId, {
          schedule: null,
          birthdayDate: '',
          loading: false,
          loaded: true,
          error: getErrorMessage(error, 'не удалось загрузить график работы')
        });
      });
  }
}

function participantStatusFromBlocks(blocks: TimelineBlock[], fallback: ParticipantStatus): ParticipantStatus {
  if (blocks.some((block) => block.type === 'absence' || block.type === 'vacation')) {
    return 'away';
  }
  if (blocks.some((block) => block.type === 'event' && !isBirthdayBlock(block))) {
    return 'busy';
  }
  return fallback;
}

function readPlanningUrlState(): PlanningUrlState {
  const params = readPlanningUrlParams();
  const duration = readPlanningUrlDuration(params.get('duration'));
  const interval = normalizePlanningUrlInterval({
    duration,
    start: readPlanningUrlTime(params.get('start')),
    end: readPlanningUrlTime(params.get('end'))
  });

  return {
    date: readPlanningUrlDate(params.get('date')),
    participantIds: readPlanningUrlIdList(params.get('participants')),
    duration,
    start: interval.start,
    end: interval.end,
    placeIds: readPlanningUrlIdList(params.get('places')),
    displayFilters: readPlanningUrlDisplayFilters(params.get('show'))
  };
}

function readPlanningUrlParams(): URLSearchParams {
  if (window.location.pathname === '/pulse/owner/calendar') {
    const hash = window.location.hash.replace(/^#/, '');
    const queryIndex = hash.indexOf('?');
    return new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : '');
  }

  return new URLSearchParams(window.location.search);
}

function readPlanningUrlDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return '';
  }

  const date = parseInputDate(value);
  return Number.isNaN(date.getTime()) || formatInputDate(date) !== value ? '' : value;
}

function readPlanningUrlIdList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return [...new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /^\d+$/.test(item) && Number(item) > 0)
  )];
}

function readPlanningUrlDuration(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const duration = Number(value);
  if (duration === workDurationMinutes) {
    return workDurationMinutes;
  }
  return duration >= minEventDurationMinutes && duration <= maxEventDurationMinutes && duration % timeStepMinutes === 0
    ? duration
    : null;
}

function readPlanningUrlTime(value: string | null): string {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) {
    return '';
  }

  const minutes = timeToMinutes(value);
  return Number.isFinite(minutes) && minutes >= workStartMinutes && minutes <= workEndMinutes ? value : '';
}

function readPlanningUrlDisplayFilters(value: string | null): DisplayFilterKey[] {
  if (value === null) {
    return [...allDisplayFilterValues];
  }

  return [...new Set(value
    .split(',')
    .filter(isDisplayFilterKey))];
}

function normalizePlanningUrlInterval(state: {
  duration: number | null;
  start: string;
  end: string;
}): { start: string; end: string } {
  if (state.duration === null) {
    return {
      start: state.start || '12:00',
      end: state.end || '13:00'
    };
  }

  const duration = state.duration === workDurationMinutes
    ? workDurationMinutes
    : clamp(state.duration, minEventDurationMinutes, maxEventDurationMinutes);
  if (duration === workDurationMinutes) {
    return {
      start: minutesToTime(workStartMinutes),
      end: minutesToTime(workEndMinutes)
    };
  }

  const fallbackStart = clamp(timeToMinutes(state.start || '12:00'), workStartMinutes, workEndMinutes - duration);
  const endFromUrl = state.end ? timeToMinutes(state.end) : fallbackStart + duration;
  const hasValidUrlInterval = endFromUrl - fallbackStart >= minEventDurationMinutes
    && endFromUrl - fallbackStart <= maxEventDurationMinutes
    && endFromUrl <= workEndMinutes;
  const end = hasValidUrlInterval ? endFromUrl : fallbackStart + duration;
  const start = clamp(end - duration, workStartMinutes, workEndMinutes - duration);
  return {
    start: minutesToTime(start),
    end: minutesToTime(start + duration)
  };
}

function readEmployeeInfoCache(): Record<string, ActiveEmployee> {
  const records = readEmployeeInfoCacheRecords();
  return Object.fromEntries(
    Object.values(records).map((record) => {
      const { updatedAt: _updatedAt, ...employee } = record;
      return [employee.id, employee];
    })
  );
}

function readEmployeeInfoCacheRecords(): Record<string, EmployeeInfoCacheRecord> {
  try {
    const rawValue = window.localStorage.getItem(employeeInfoCacheStorageKey);
    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsedValue)
        .map(([id, value]) => normalizeEmployeeInfoCacheRecord(value, id))
        .filter((record): record is EmployeeInfoCacheRecord => record !== null)
        .map((record) => [record.id, record])
    );
  } catch {
    return {};
  }
}

function normalizeEmployeeInfoCacheRecord(value: unknown, fallbackId = ''): EmployeeInfoCacheRecord | null {
  const employee = normalizeActiveEmployee(value, fallbackId);
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (!employee) {
    return null;
  }

  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
    ? record.updatedAt
    : 0;
  return {
    ...employee,
    updatedAt
  };
}

function normalizeActiveEmployee(value: unknown, fallbackId = ''): ActiveEmployee | null {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!record) {
    return null;
  }

  const id = readPositiveStringId(record.id ?? fallbackId);
  const name = readCachedEmployeeString(record.name) || readCachedEmployeeString(record.fullName);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    fullName: readCachedEmployeeString(record.fullName) || name,
    avatarUrl: readCachedEmployeeString(record.avatarUrl),
    status: readCachedEmployeeStatus(record.status),
    statusText: readCachedEmployeeString(record.statusText)
  };
}

function readCachedEmployeeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPositiveStringId(value: unknown): string {
  const id = typeof value === 'number' && Number.isInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  return /^\d+$/.test(id) && Number(id) > 0 ? id : '';
}

function readCachedEmployeeStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return null;
}

function createInitialKnownActiveEmployees(participantIds: string[]): Record<string, ActiveEmployee> {
  return Object.fromEntries(participantIds.map((id) => [
    id,
    initialEmployeeInfoCache[id] ?? createFallbackActiveEmployee(id)
  ]));
}

function createFallbackActiveEmployee(id: string): ActiveEmployee {
  return {
    id,
    name: `Сотрудник ${id}`,
    fullName: `Сотрудник ${id}`,
    avatarUrl: '',
    status: null,
    statusText: ''
  };
}

function schedulePlanningUrlSync(): void {
  if (planningUrlSyncTimeout) {
    window.clearTimeout(planningUrlSyncTimeout);
  }

  planningUrlSyncTimeout = window.setTimeout(() => {
    planningUrlSyncTimeout = 0;
    writePlanningUrlState();
  }, 120);
}

function writePlanningUrlState(): void {
  const url = new URL(window.location.href);
  const params = url.pathname === '/pulse/owner/calendar'
    ? readPlanningUrlParams()
    : new URLSearchParams(url.search);

  planningUrlParamNames.forEach((name) => params.delete(name));
  params.set('date', selectedDate.value);
  if (visibleParticipantIds.value.length) {
    params.set('participants', visibleParticipantIds.value.join(','));
  }
  if (eventDuration.value !== null) {
    params.set('duration', String(eventDuration.value));
    params.set('start', eventForm.start);
    params.set('end', eventForm.end);
  }
  if (selectedPlaceIds.value.length) {
    params.set('places', selectedPlaceIds.value.join(','));
  }
  params.set('show', visibleDisplayFilters.value.join(','));

  if (url.pathname === '/pulse/owner/calendar') {
    const query = params.toString();
    url.hash = query ? `schedule?${query}` : 'schedule';
  } else {
    url.search = params.toString();
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', nextUrl);
  }
}

function formatInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string): string {
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) {
    return value;
  }
  return `${day}.${month}.${year}`;
}

function formatCalendarTitleDate(value: string): string {
  return calendarTitleDateFormatter.format(parseInputDate(value)).replace('.', '');
}

function parseInputDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function calendarGridStart(date: Date): Date {
  const firstDay = startOfMonth(date);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(firstDay.getTime());
  start.setDate(firstDay.getDate() - mondayOffset);
  return start;
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('ru-RU') + value.slice(1);
}

function moveDatePickerMonth(amount: number): void {
  datePickerTransitionName.value = amount > 0 ? 'planning-calendar-slide-next' : 'planning-calendar-slide-prev';
  datePickerMonth.value = addMonths(datePickerMonth.value, amount);
}

function moveDatePickerPage(amount: number): void {
  datePickerTransitionName.value = amount > 0 ? 'planning-calendar-slide-next' : 'planning-calendar-slide-prev';
  if (datePickerView.value === 'years') {
    datePickerMonth.value = addMonths(datePickerMonth.value, amount * 12 * datePickerYearItems.value.length);
    return;
  }
  if (datePickerView.value === 'months') {
    datePickerMonth.value = addMonths(datePickerMonth.value, amount * 12);
    return;
  }
  moveDatePickerMonth(amount);
}

function resetCalendarToSelectedDate(): void {
  datePickerTransitionName.value = 'planning-calendar-view-transition';
  datePickerMonth.value = startOfMonth(parseInputDate(selectedDate.value));
  datePickerView.value = 'dates';
}

function toggleCalendarYearPicker(): void {
  datePickerTransitionName.value = 'planning-calendar-view-transition';
  datePickerView.value = datePickerView.value === 'years' ? 'dates' : 'years';
}

function toggleCalendarMonthPicker(): void {
  datePickerTransitionName.value = 'planning-calendar-view-transition';
  datePickerView.value = datePickerView.value === 'months' ? 'dates' : 'months';
}

function selectCalendarMonth(monthIndex: number): void {
  datePickerTransitionName.value = 'planning-calendar-view-transition';
  datePickerMonth.value = new Date(datePickerMonth.value.getFullYear(), monthIndex, 1);
  datePickerView.value = 'dates';
}

function selectCalendarYear(year: number): void {
  datePickerTransitionName.value = 'planning-calendar-view-transition';
  datePickerMonth.value = new Date(year, datePickerMonth.value.getMonth(), 1);
  datePickerView.value = 'dates';
}

function selectCalendarDate(day: CalendarDay): void {
  if (day.disabled) {
    return;
  }
  selectedDate.value = day.value;
  dateMenu.value = false;
}

function selectTodayDate(): void {
  selectedDate.value = todayDateValue.value;
  datePickerMonth.value = startOfMonth(parseInputDate(todayDateValue.value));
  datePickerView.value = 'dates';
  dateMenu.value = false;
}

function refreshTodayDate(): void {
  const previousToday = todayDateValue.value;
  const currentToday = formatInputDate(new Date());
  if (currentToday === previousToday) {
    return;
  }

  todayDateValue.value = currentToday;
  if (selectedDate.value === previousToday) {
    selectedDate.value = currentToday;
    datePickerMonth.value = startOfMonth(parseInputDate(currentToday));
  }
}

function scheduleTodayDateRefresh(): void {
  if (todayDateUpdateTimeout) {
    window.clearTimeout(todayDateUpdateTimeout);
  }

  const now = new Date();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const delay = Math.max(1000, nextDay.getTime() - now.getTime() + 500);
  todayDateUpdateTimeout = window.setTimeout(() => {
    todayDateUpdateTimeout = 0;
    refreshTodayDate();
    scheduleTodayDateRefresh();
  }, delay);
}

function syncTodayDate(): void {
  refreshTodayDate();
  scheduleTodayDateRefresh();
}

function syncTodayDateOnVisibilityChange(): void {
  if (document.visibilityState !== 'hidden') {
    syncTodayDate();
  }
}

function readCurrentClockMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() + (now.getSeconds() >= 30 ? 0.5 : 0);
}

function syncCurrentTime(): void {
  currentTimeMinutes.value = readCurrentClockMinutes();
  scheduleCurrentTimeRefresh();
}

function scheduleCurrentTimeRefresh(): void {
  if (currentTimeUpdateTimeout) {
    window.clearTimeout(currentTimeUpdateTimeout);
  }

  const now = new Date();
  const secondsToNextBoundary = now.getSeconds() < 30 ? 30 - now.getSeconds() : 60 - now.getSeconds();
  const millisecondsToNextBoundary = secondsToNextBoundary * 1000 - now.getMilliseconds() + 20;
  currentTimeUpdateTimeout = window.setTimeout(syncCurrentTime, Math.max(250, millisecondsToNextBoundary));
}

function syncCurrentTimeOnVisibilityChange(): void {
  if (document.visibilityState !== 'hidden') {
    syncCurrentTime();
  }
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatDurationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} ${formatRussianPlural(hours, 'час', 'часа', 'часов')}`);
  }
  if (restMinutes > 0 || parts.length === 0) {
    parts.push(`${restMinutes} мин`);
  }

  return parts.join(' ');
}

function formatRussianPlural(value: number, one: string, few: string, many: string): string {
  const lastTwoDigits = value % 100;
  const lastDigit = value % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return many;
  }
  if (lastDigit === 1) {
    return one;
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return few;
  }

  return many;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('ru-RU');
}

function timelinePersonNameParts(name: string): string[] {
  const parts = name.split(' ').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, 2) : parts;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const normalizedMinutes = Math.max(0, Math.min(minutes, 23 * 60 + 59));
  const hours = Math.floor(normalizedMinutes / 60);
  const rest = normalizedMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function applyDurationToEventForm(duration: number): void {
  const safeDuration = clamp(duration, minEventDurationMinutes, workDurationMinutes);
  if (safeDuration === workDurationMinutes) {
    eventForm.start = minutesToTime(workStartMinutes);
    eventForm.end = minutesToTime(workEndMinutes);
    return;
  }

  let start = clamp(timeToMinutes(eventForm.start), workStartMinutes, workEndMinutes - safeDuration);
  let end = start + safeDuration;
  if (end > workEndMinutes) {
    end = workEndMinutes;
    start = end - safeDuration;
  }

  eventForm.start = minutesToTime(start);
  eventForm.end = minutesToTime(end);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function snapToTimeStep(minutes: number): number {
  return clamp(Math.round(minutes / timeStepMinutes) * timeStepMinutes, workStartMinutes, workEndMinutes);
}

function minutesToTimelinePercent(minutes: number): number {
  return ((clamp(minutes, timelineStartMinutes, timelineEndMinutes) - timelineStartMinutes) / timelineDurationMinutes) * 100;
}

function timelineShadeStyle(left: number, width: number, widthValue = `${width}%`): Record<string, string> {
  const safeWidth = Math.max(width, 0);
  const style: Record<string, string> = {
    left: `${left}%`,
    width: widthValue,
    '--timeline-shade-origin-left': '0%',
    '--timeline-shade-origin-width': '100%'
  };
  if (safeWidth > 0) {
    style['--timeline-shade-origin-left'] = `${-(left / safeWidth) * 100}%`;
    style['--timeline-shade-origin-width'] = `${(100 / safeWidth) * 100}%`;
  }
  return style;
}

function updateTimelineScaleLayerWidth(): void {
  const width = timelineScaleLayer.value?.getBoundingClientRect().width ?? 0;
  timelineScaleLayerWidth.value = width > 0 ? width : timelineTrackMinWidth;
}

function timelineHandleStyle(minutes: number): Record<string, string> {
  const percent = minutesToTimelinePercent(minutes);
  if (percent <= 0) {
    return { left: '0%', transform: 'translateX(0)' };
  }
  if (percent >= 100) {
    return { left: '100%', transform: 'translateX(-100%)' };
  }
  return { left: `${percent}%` };
}

function timelineHandlePixelStyle(positionPx: number, widthPx: number): Record<string, string> {
  const safeWidth = Math.max(widthPx, 1);
  const position = clamp(positionPx, 0, safeWidth);
  if (position <= 0) {
    return { left: '0%', transform: 'translateX(0)' };
  }
  if (position >= safeWidth) {
    return { left: '100%', transform: 'translateX(-100%)' };
  }
  return { left: `${position}px` };
}

function selectedIntervalHandleStyle(handle: TimelineHandle): Record<string, string> {
  const start = selectedIntervalStartMinutes.value;
  const end = selectedIntervalEndMinutes.value;
  const width = Math.max(timelineScaleLayerWidth.value, 1);
  const startPx = (minutesToTimelinePercent(start) / 100) * width;
  const endPx = (minutesToTimelinePercent(end) / 100) * width;
  const actualGapPx = endPx - startPx;

  if (actualGapPx >= timelineHandleMinCenterGapPx) {
    return timelineHandleStyle(handle === 'start' ? start : end);
  }

  const [visualStartPx, visualEndPx] = separatedTimelineHandlePositions(startPx, endPx, width);
  return timelineHandlePixelStyle(handle === 'start' ? visualStartPx : visualEndPx, width);
}

function separatedTimelineHandlePositions(startPx: number, endPx: number, widthPx: number): [number, number] {
  const safeWidth = Math.max(widthPx, 1);
  const gap = Math.min(timelineHandleMinCenterGapPx, safeWidth);
  const midpoint = (startPx + endPx) / 2;
  const startPosition = clamp(midpoint - gap / 2, 0, safeWidth - gap);
  return [startPosition, startPosition + gap];
}

function intervalsOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function minutesFromTimelinePointer(event: PointerEvent, layer: HTMLElement): number {
  const rect = layer.getBoundingClientRect();
  const ratio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
  return snapToTimeStep(timelineStartMinutes + ratio * timelineDurationMinutes);
}

function setTimelineHandle(handle: TimelineHandle, minutes: number): void {
  let start = selectedIntervalStartMinutes.value;
  let end = selectedIntervalEndMinutes.value;

  if (handle === 'start') {
    start = clamp(minutes, Math.max(workStartMinutes, end - maxEventDurationMinutes), end - minEventDurationMinutes);
  } else {
    end = clamp(minutes, start + minEventDurationMinutes, Math.min(workEndMinutes, start + maxEventDurationMinutes));
  }

  eventForm.start = minutesToTime(start);
  eventForm.end = minutesToTime(end);
  eventDuration.value = end - start;
}

function setTimelineRange(startMinutes: number): void {
  const duration = Math.max(timelineRangeDragDurationMinutes, minEventDurationMinutes);
  const start = clamp(startMinutes, workStartMinutes, workEndMinutes - duration);
  const end = start + duration;

  eventForm.start = minutesToTime(start);
  eventForm.end = minutesToTime(end);
  eventDuration.value = duration;
}

function beginTimelineDrag(handle: TimelineHandle, event: PointerEvent, layer: HTMLElement): void {
  stopTimelineDrag();
  activeTimelineHandle.value = handle;
  timelineDragLayer = layer;
  lockTimelineCursor('timeline-dragging-resize');
  timelineHandleDragStartMinutes = handle === 'start' ? selectedIntervalStartMinutes.value : selectedIntervalEndMinutes.value;
  timelineHandleDragStartClientX = event.clientX;
  timelineHandleDragLayerWidth = Math.max(layer.getBoundingClientRect().width, 1);
  window.addEventListener('pointermove', updateTimelineDrag);
  window.addEventListener('pointerup', stopTimelineDrag);
  window.addEventListener('pointercancel', stopTimelineDrag);
  event.preventDefault();
}

function beginTimelineRangeDrag(event: PointerEvent, layer: HTMLElement): void {
  stopTimelineDrag();
  activeTimelineHandle.value = 'range';
  timelineDragLayer = layer;
  lockTimelineCursor('timeline-dragging-range');
  timelineRangeDragDurationMinutes = Math.max(selectedIntervalEndMinutes.value - selectedIntervalStartMinutes.value, minEventDurationMinutes);
  const pointerMinutes = minutesFromTimelinePointer(event, layer);
  timelineRangeDragOffsetMinutes = clamp(
    pointerMinutes - selectedIntervalStartMinutes.value,
    0,
    timelineRangeDragDurationMinutes
  );
  setTimelineRange(pointerMinutes - timelineRangeDragOffsetMinutes);
  window.addEventListener('pointermove', updateTimelineDrag);
  window.addEventListener('pointerup', stopTimelineDrag);
  window.addEventListener('pointercancel', stopTimelineDrag);
  event.preventDefault();
}

function getTimelineDragLayer(event: PointerEvent): HTMLElement | null {
  const layer = (event.currentTarget as HTMLElement).closest('.timeline-scale-layer');
  return layer instanceof HTMLElement ? layer : null;
}

function startTimelineDrag(handle: TimelineHandle, event: PointerEvent): void {
  const layer = getTimelineDragLayer(event);
  if (layer) {
    beginTimelineDrag(handle, event, layer);
  }
}

function startTimelineRangeDrag(event: PointerEvent): void {
  const layer = getTimelineDragLayer(event);
  if (layer) {
    beginTimelineRangeDrag(event, layer);
  }
}

function updateTimelineDrag(event: PointerEvent): void {
  const dragTarget = activeTimelineHandle.value;
  if (!dragTarget || !timelineDragLayer) {
    return;
  }
  const minutes = minutesFromTimelinePointer(event, timelineDragLayer);
  if (dragTarget === 'range') {
    setTimelineRange(minutes - timelineRangeDragOffsetMinutes);
    return;
  }
  const deltaMinutes = ((event.clientX - timelineHandleDragStartClientX) / timelineHandleDragLayerWidth) * timelineDurationMinutes;
  setTimelineHandle(dragTarget, snapToTimeStep(timelineHandleDragStartMinutes + deltaMinutes));
}

function lockTimelineCursor(className: 'timeline-dragging-range' | 'timeline-dragging-resize'): void {
  if (timelineCursorLockClass) {
    document.body.classList.remove(timelineCursorLockClass);
  }
  timelineCursorLockClass = className;
  document.body.classList.add(className);
}

function unlockTimelineCursor(): void {
  if (!timelineCursorLockClass) {
    return;
  }
  document.body.classList.remove(timelineCursorLockClass);
  timelineCursorLockClass = null;
}

function stopTimelineDrag(): void {
  if (!activeTimelineHandle.value) {
    unlockTimelineCursor();
    return;
  }
  activeTimelineHandle.value = null;
  timelineDragLayer = null;
  timelineRangeDragOffsetMinutes = 0;
  timelineRangeDragDurationMinutes = minEventDurationMinutes;
  timelineHandleDragStartMinutes = 0;
  timelineHandleDragStartClientX = 0;
  timelineHandleDragLayerWidth = timelineTrackMinWidth;
  unlockTimelineCursor();
  window.removeEventListener('pointermove', updateTimelineDrag);
  window.removeEventListener('pointerup', stopTimelineDrag);
  window.removeEventListener('pointercancel', stopTimelineDrag);
}

function setDurationFromDropdown(value: unknown): void {
  if (typeof value !== 'number') {
    eventDuration.value = null;
    return;
  }

  const duration = value === workDurationMinutes
    ? workDurationMinutes
    : clamp(value, minEventDurationMinutes, maxEventDurationMinutes);
  eventDuration.value = duration;
  applyDurationToEventForm(duration);
}

function handlePlanningButtonPointerDown(event: PointerEvent): void {
  if (event.pointerType !== 'touch' && event.button !== 0) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const button = target.closest('button');
  if (
    !(button instanceof HTMLButtonElement)
    || button.disabled
    || button.getAttribute('aria-disabled') === 'true'
    || !button.closest('.pulse-plus-event-planning-root, .planning-select-menu, .planning-date-menu, .pulse-plus-event-planning-menu-content')
  ) {
    return;
  }

  runPlanningButtonRipple(button, event);
}

function runPlanningButtonRipple(button: HTMLElement, event: PointerEvent): void {
  const rect = button.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const size = Math.max(rect.width, rect.height) * 2;
  const ripple = document.createElement('span');
  ripple.className = 'planning-button-ripple';
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  button.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}

function setPlaceFromDropdown(value: unknown): void {
  const availableIds = new Set(placeSelectItems.value.map((item) => String(item.value)));
  selectedPlaceIds.value = Array.isArray(value)
    ? value.map((item) => String(item)).filter((placeId) => availableIds.has(placeId))
    : [];
}

function isDisplayFilterKey(value: unknown): value is DisplayFilterKey {
  return value === 'events' || value === 'absences' || value === 'vacations';
}

function setDisplayFiltersFromDropdown(value: unknown): void {
  visibleDisplayFilters.value = Array.isArray(value) ? value.filter(isDisplayFilterKey) : [];
}

function setParticipantFilterFromDropdown(value: unknown): void {
  const availableIds = new Set([...activeEmployeeById.value.keys(), ...participantById.value.keys()]);
  const nextVisibleIds = Array.isArray(value)
    ? value.map((id) => String(id)).filter((id) => availableIds.has(id))
    : [];
  const nextVisibleSet = new Set(nextVisibleIds);
  visibleParticipantIds.value = nextVisibleIds;
  selectedParticipantIds.value = selectedParticipantIds.value.filter((id) => nextVisibleSet.has(id));
  if (selectedParticipantId.value && !nextVisibleSet.has(selectedParticipantId.value)) {
    setPrimaryParticipant(selectedParticipantIds.value[selectedParticipantIds.value.length - 1] ?? '');
  }
}

function rememberActiveEmployees(employees: ActiveEmployee[]): void {
  const normalizedEmployees = employees
    .map((employee) => normalizeActiveEmployee(employee))
    .filter((employee): employee is ActiveEmployee => employee !== null);
  if (normalizedEmployees.length === 0) {
    return;
  }

  const nextKnownEmployees = { ...knownActiveEmployeesById.value };
  let hasKnownChanges = false;
  const rememberedEmployees: ActiveEmployee[] = [];
  for (const employee of normalizedEmployees) {
    const existingEmployee = nextKnownEmployees[employee.id];
    const mergedEmployee = mergeActiveEmployee(existingEmployee, employee);
    rememberedEmployees.push(mergedEmployee);
    if (!existingEmployee || activeEmployeeChanged(existingEmployee, mergedEmployee)) {
      nextKnownEmployees[employee.id] = mergedEmployee;
      hasKnownChanges = true;
    }
  }

  if (hasKnownChanges) {
    knownActiveEmployeesById.value = nextKnownEmployees;
  }

  syncCachedActiveEmployeeItems(rememberedEmployees);
  writeEmployeeInfoCache(rememberedEmployees);
}

function rememberEmployeeProfile(profile: EmployeeProfile | null | undefined): void {
  if (!profile) {
    return;
  }

  const employee = activeEmployeeFromProfile(profile, activeEmployeeById.value.get(profile.id));
  if (employee) {
    rememberActiveEmployees([employee]);
  }
}

function refreshVisibleEmployeeInfo(participantIds: string[]): void {
  [...new Set(participantIds)]
    .map((participantId) => readPositiveStringId(participantId))
    .filter(Boolean)
    .forEach((participantId) => {
      if (
        participantId === currentUserParticipantId.value
        || employeeInfoRefreshRequestedIds.has(participantId)
        || employeeInfoRefreshInFlightIds.has(participantId)
      ) {
        return;
      }

      employeeInfoRefreshRequestedIds.add(participantId);
      employeeInfoRefreshInFlightIds.add(participantId);
      void getEmployeeProfile(participantId)
        .then((profile) => {
          rememberEmployeeProfile(profile);
        })
        .catch(() => {
          employeeInfoRefreshRequestedIds.delete(participantId);
        })
        .finally(() => {
          employeeInfoRefreshInFlightIds.delete(participantId);
        });
    });
}

function activeEmployeeFromProfile(
  profile: EmployeeProfile,
  existingEmployee: ActiveEmployee | undefined
): ActiveEmployee | null {
  const id = readPositiveStringId(profile.id);
  const name = profile.name.trim();
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    fullName: profile.name.trim(),
    avatarUrl: profile.avatarUrl.trim(),
    status: existingEmployee?.status ?? null,
    statusText: existingEmployee?.statusText ?? ''
  };
}

function mergeActiveEmployee(existingEmployee: ActiveEmployee | undefined, employee: ActiveEmployee): ActiveEmployee {
  if (!existingEmployee) {
    return employee;
  }

  return {
    ...employee,
    status: employee.status ?? existingEmployee.status,
    statusText: employee.statusText || existingEmployee.statusText
  };
}

function activeEmployeeChanged(left: ActiveEmployee, right: ActiveEmployee): boolean {
  return left.id !== right.id
    || left.name !== right.name
    || left.fullName !== right.fullName
    || left.avatarUrl !== right.avatarUrl
    || left.status !== right.status
    || left.statusText !== right.statusText;
}

function writeEmployeeInfoCache(employees: ActiveEmployee[]): void {
  const cacheRecords = readEmployeeInfoCacheRecords();
  let hasChanges = false;
  const now = Date.now();
  for (const employee of employees) {
    const normalizedEmployee = normalizeActiveEmployee(employee);
    if (!normalizedEmployee) {
      continue;
    }

    const existingRecord = cacheRecords[normalizedEmployee.id];
    if (!existingRecord || activeEmployeeChanged(existingRecord, normalizedEmployee)) {
      cacheRecords[normalizedEmployee.id] = {
        ...normalizedEmployee,
        updatedAt: now
      };
      hasChanges = true;
    }
  }

  if (!hasChanges) {
    return;
  }

  try {
    window.localStorage.setItem(employeeInfoCacheStorageKey, JSON.stringify(cacheRecords));
  } catch {
    // Storage can be unavailable or full; the live API data is still used.
  }
}

function syncCachedActiveEmployeeItems(employees: ActiveEmployee[]): void {
  if (activeEmployees.data.value) {
    return;
  }

  const itemsById = new Map(displayedActiveEmployeeItems.value.map((employee) => [employee.id, employee]));
  let hasChanges = false;
  for (const employee of employees) {
    const existingEmployee = itemsById.get(employee.id);
    if (!existingEmployee || activeEmployeeChanged(existingEmployee, employee)) {
      itemsById.set(employee.id, employee);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    displayedActiveEmployeeItems.value = [...itemsById.values()];
  }
}

function cachedEmployeeAvatarUrl(sourceUrl: string): string {
  employeeAvatarCacheRevision.value;
  if (!sourceUrl) {
    return '';
  }

  return employeeAvatarCache.get(sourceUrl)?.objectUrl ?? '';
}

function preloadEmployeeAvatars(sourceUrls: string[]): void {
  cleanupEmployeeAvatarCache();
  [...new Set(sourceUrls)].forEach((sourceUrl) => {
    ensureEmployeeAvatarCached(sourceUrl);
  });
}

function ensureEmployeeAvatarCached(sourceUrl: string): void {
  if (!sourceUrl) {
    return;
  }

  const now = Date.now();
  const existingEntry = employeeAvatarCache.get(sourceUrl);
  if (existingEntry) {
    if (existingEntry.promise || existingEntry.expiresAt > now) {
      return;
    }

    existingEntry.promise = loadEmployeeAvatar(sourceUrl, existingEntry);
    scheduleEmployeeAvatarCacheCleanup();
    return;
  }

  const entry: EmployeeAvatarCacheEntry = {
    objectUrl: '',
    expiresAt: 0,
    promise: null
  };
  entry.promise = loadEmployeeAvatar(sourceUrl, entry);
  employeeAvatarCache.set(sourceUrl, entry);
  scheduleEmployeeAvatarCacheCleanup();
}

async function loadEmployeeAvatar(sourceUrl: string, entry: EmployeeAvatarCacheEntry): Promise<void> {
  try {
    const response = await fetch(sourceUrl, {
      credentials: 'include',
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error(`Не удалось загрузить изображение сотрудника: ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob.size) {
      throw new Error('Пустое изображение сотрудника');
    }

    const objectUrl = window.URL.createObjectURL(blob);
    if (employeeAvatarCache.get(sourceUrl) !== entry) {
      window.URL.revokeObjectURL(objectUrl);
      return;
    }

    if (entry.objectUrl) {
      window.URL.revokeObjectURL(entry.objectUrl);
    }
    entry.objectUrl = objectUrl;
    entry.expiresAt = Date.now() + employeeAvatarCacheTtlMs;
    entry.promise = null;
    employeeAvatarCacheRevision.value += 1;
  } catch (error) {
    if (employeeAvatarCache.get(sourceUrl) === entry) {
      entry.promise = null;
      if (!entry.objectUrl) {
        employeeAvatarCache.delete(sourceUrl);
      }
    }
    console.warn('[Trick Plus] Employee avatar cache failed:', error);
  }
}

function cleanupEmployeeAvatarCache(): void {
  const now = Date.now();
  const activeUrls = new Set(employeeAvatarSourceUrls.value);
  let changed = false;

  employeeAvatarCache.forEach((entry, sourceUrl) => {
    if (entry.promise || activeUrls.has(sourceUrl) || entry.expiresAt > now) {
      return;
    }

    if (entry.objectUrl) {
      window.URL.revokeObjectURL(entry.objectUrl);
    }
    employeeAvatarCache.delete(sourceUrl);
    changed = true;
  });

  if (changed) {
    employeeAvatarCacheRevision.value += 1;
  }
}

function scheduleEmployeeAvatarCacheCleanup(): void {
  if (employeeAvatarCacheCleanupTimer) {
    return;
  }

  employeeAvatarCacheCleanupTimer = window.setTimeout(() => {
    employeeAvatarCacheCleanupTimer = 0;
    cleanupEmployeeAvatarCache();
    preloadEmployeeAvatars(employeeAvatarSourceUrls.value);
    if (employeeAvatarCache.size > 0) {
      scheduleEmployeeAvatarCacheCleanup();
    }
  }, Math.min(30 * 1000, employeeAvatarCacheTtlMs));
}

function clearEmployeeAvatarCache(): void {
  if (employeeAvatarCacheCleanupTimer) {
    window.clearTimeout(employeeAvatarCacheCleanupTimer);
    employeeAvatarCacheCleanupTimer = 0;
  }

  employeeAvatarCache.forEach((entry) => {
    if (entry.objectUrl) {
      window.URL.revokeObjectURL(entry.objectUrl);
    }
  });
  employeeAvatarCache.clear();
}

function setParticipantSearch(value: string): void {
  participantSearch.value = value;
}

function resetLoadedParticipantPages(): void {
  queryClient.setQueriesData({ queryKey: ['planning-active-employees'] }, trimInfiniteQueryToFirstPage);
}

function trimInfiniteQueryToFirstPage(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const infiniteData = data as { pages?: unknown[]; pageParams?: unknown[] };
  if (!Array.isArray(infiniteData.pages) || infiniteData.pages.length <= 1) {
    return data;
  }

  return {
    ...infiniteData,
    pages: infiniteData.pages.slice(0, 1),
    pageParams: Array.isArray(infiniteData.pageParams) ? infiniteData.pageParams.slice(0, 1) : infiniteData.pageParams
  };
}

function loadMoreParticipants(): void {
  if (!activeEmployees.hasNextPage.value || activeEmployees.isFetchingNextPage.value) {
    return;
  }
  void activeEmployees.fetchNextPage();
}

function syncTimelineHorizontalScroll(source: 'header' | 'body'): void {
  const sourceElement = source === 'header' ? timelineHeaderScroll.value : timelineBodyScroll.value;
  const targetElement = source === 'header' ? timelineBodyScroll.value : timelineHeaderScroll.value;
  if (!sourceElement || !targetElement || (timelineScrollSyncSource && timelineScrollSyncSource !== source)) {
    return;
  }

  if (targetElement.scrollLeft === sourceElement.scrollLeft) {
    return;
  }

  timelineScrollSyncSource = source;
  if (timelineScrollSyncFrame) {
    window.cancelAnimationFrame(timelineScrollSyncFrame);
  }
  targetElement.scrollLeft = sourceElement.scrollLeft;
  timelineScrollSyncFrame = window.requestAnimationFrame(() => {
    timelineScrollSyncFrame = 0;
    timelineScrollSyncSource = null;
  });
}

function blockStyle(block: TimelineLaidOutBlock): Record<string, string> {
  const start = Math.max(timeToMinutes(block.start), timelineStartMinutes);
  const end = Math.min(timeToMinutes(block.end), timelineEndMinutes);
  const left = ((start - timelineStartMinutes) / timelineDurationMinutes) * 100;
  const width = (Math.max(end - start, 0) / timelineDurationMinutes) * 100;
  const top = timelineBlockVerticalPaddingPx + block.lane * (timelineBlockHeightPx + timelineBlockLaneGapPx);
  const eventTypeStyle = block.eventTypeId !== undefined && block.eventTypeId !== null
    ? calendarEventTypeById.value.get(block.eventTypeId)
    : null;
  return {
    left: `calc(${left}% + 1px)`,
    top: `${top}px`,
    width: `calc(${width}% - 1px)`,
    ...blockEventTypeStyle(eventTypeStyle)
  };
}

function blockEventTypeStyle(eventType: CalendarEventTypeDefinition | null | undefined): Record<string, string> {
  if (!eventType) {
    return {};
  }
  return {
    '--schedule-block-color': eventType.cssColor,
    '--schedule-block-bg': eventType.backgroundColor,
    '--schedule-block-text': eventType.textColor
  };
}

function isBirthdayBlock(block: TimelineBlock): boolean {
  const title = block.title.toLocaleLowerCase('ru-RU');
  return block.eventTypeId === birthdayEventTypeId || title.includes('день рождения') || title.includes('дни рождения') || title.includes('birthday');
}

function isBirthdayDateOnSelectedDate(birthdayDate: string): boolean {
  if (!birthdayDate) {
    return false;
  }

  const [, birthdayMonth, birthdayDay] = birthdayDate.split('-');
  const [, selectedMonth, selectedDay] = selectedDate.value.split('-');
  return Boolean(birthdayMonth && birthdayDay && birthdayMonth === selectedMonth && birthdayDay === selectedDay);
}

function isParticipantBirthdayBlock(block: TimelineBlock, participantId: string, participantName: string): boolean {
  if (!isBirthdayBlock(block)) {
    return false;
  }
  if (block.birthdayEmployeeId) {
    return block.birthdayEmployeeId === participantId;
  }
  if (block.birthdayEmployeeName) {
    return samePersonName(block.birthdayEmployeeName, participantName);
  }
  return false;
}

function samePersonName(left: string, right: string): boolean {
  const leftParts = normalizePersonNameParts(left);
  const rightParts = normalizePersonNameParts(right);
  if (leftParts.length === 0 || rightParts.length === 0) {
    return false;
  }

  const leftHasRight = rightParts.every((part) => leftParts.includes(part));
  const rightHasLeft = leftParts.every((part) => rightParts.includes(part));
  return leftHasRight || rightHasLeft;
}

function normalizePersonNameParts(value: string): string[] {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/iu)
    .filter((part) => part.length > 1);
}

function workScheduleStartOfftimeStyle(schedule: EmployeeWorkSchedule): Record<string, string> {
  const left = minutesToTimelinePercent(workStartMinutes);
  const right = minutesToTimelinePercent(clamp(timeToMinutes(schedule.start), workStartMinutes, workEndMinutes));
  return timelineShadeStyle(left, Math.max(right - left, 0));
}

function workScheduleEndOfftimeStyle(schedule: EmployeeWorkSchedule): Record<string, string> {
  const end = clamp(timeToMinutes(schedule.end), workStartMinutes, workEndMinutes);
  const left = minutesToTimelinePercent(end);
  const right = minutesToTimelinePercent(workEndMinutes);
  return timelineShadeStyle(left, Math.max(right - left, 0));
}

function workScheduleStartBoundaryStyle(schedule: EmployeeWorkSchedule): Record<string, string> {
  return {
    left: `${minutesToTimelinePercent(timeToMinutes(schedule.start))}%`
  };
}

function workScheduleEndBoundaryStyle(schedule: EmployeeWorkSchedule): Record<string, string> {
  return {
    left: `${minutesToTimelinePercent(timeToMinutes(schedule.end))}%`
  };
}

function visibleBlocks(row: { blocks: TimelineBlock[] }): TimelineBlock[] {
  return row.blocks
    .filter((block) => {
      if (isBirthdayBlock(block) || !blockOverlapsTimeline(block)) {
        return false;
      }
      if (block.type === 'absence') {
        return showAbsences.value;
      }
      if (block.type === 'vacation') {
        return showVacations.value;
      }
      return showEvents.value;
    })
    .sort(compareTimelineBlocks);
}

function timelineRowLayout(row: TimelineDisplayRow): TimelineRowLayout {
  return timelineRowLayouts.value.get(row.key) ?? buildTimelineRowLayout(row);
}

function timelineRowBlocks(row: TimelineDisplayRow): TimelineLaidOutBlock[] {
  return timelineRowLayout(row).blocks;
}

function timelineBlockKey(row: TimelineDisplayRow, block: TimelineLaidOutBlock): string {
  return `${row.key}:${block.id}:${block.start}:${block.end}:${block.lane}`;
}

function timelineRowStyle(row: TimelineDisplayRow): Record<string, string> {
  return {
    '--timeline-row-height': `${timelineRowLayout(row).height}px`
  };
}

function buildTimelineRowLayout(row: { blocks: TimelineBlock[] }): TimelineRowLayout {
  const lanes: TimelineBlockRange[][] = [];
  const blocks = visibleBlocks(row).map((block) => {
    const range = blockTimelineRange(block);
    const existingLaneIndex = lanes.findIndex((laneBlocks) =>
      laneBlocks.every((laneBlock) => !timelineRangesOverlap(range, laneBlock))
    );
    const lane = existingLaneIndex >= 0 ? existingLaneIndex : lanes.length;
    if (!lanes[lane]) {
      lanes[lane] = [];
    }
    lanes[lane].push(range);
    return {
      ...block,
      lane
    };
  });
  const laneCount = Math.max(lanes.length, 1);
  return {
    blocks,
    laneCount,
    height: timelineRowHeightForLaneCount(laneCount)
  };
}

function blockTimelineRange(block: TimelineBlock): TimelineBlockRange {
  const start = Math.max(timeToMinutes(block.start), timelineStartMinutes);
  const end = Math.max(Math.min(timeToMinutes(block.end), timelineEndMinutes), start);
  return { start, end };
}

function timelineRangesOverlap(left: TimelineBlockRange, right: TimelineBlockRange): boolean {
  return left.start < right.end && left.end > right.start;
}

function timelineRowHeightForLaneCount(laneCount: number): number {
  return Math.max(
    timelineRowMinHeightPx,
    timelineBlockVerticalPaddingPx * 2
      + laneCount * timelineBlockHeightPx
      + Math.max(laneCount - 1, 0) * timelineBlockLaneGapPx
  );
}

function blockOverlapsTimeline(block: TimelineBlock): boolean {
  return timeToMinutes(block.start) < timelineEndMinutes && timeToMinutes(block.end) > timelineStartMinutes;
}

function formatBlockTime(block: TimelineBlock): string {
  return block.displayTime || (block.allDay ? 'Весь день' : `${block.start}-${block.end}`);
}

function compareTimelineBlocks(left: TimelineBlock, right: TimelineBlock): number {
  const startDiff = timeToMinutes(left.start) - timeToMinutes(right.start);
  if (startDiff !== 0) {
    return startDiff;
  }

  return timeToMinutes(left.end) - timeToMinutes(right.end);
}

function setPrimaryParticipant(participantId: string): void {
  selectedParticipantId.value = participantId;
  eventForm.participantId = participantId;
}

function selectParticipant(participantId: string): void {
  if (!selectedParticipantIds.value.includes(participantId)) {
    selectedParticipantIds.value = [...selectedParticipantIds.value, participantId];
  }
  if (!visibleParticipantIds.value.includes(participantId)) {
    visibleParticipantIds.value = [...visibleParticipantIds.value, participantId];
  }
  setPrimaryParticipant(participantId);
  selectedBlockId.value = null;
}

function toggleParticipantSelection(participantId: string): void {
  if (!selectedParticipantIds.value.includes(participantId)) {
    selectParticipant(participantId);
    return;
  }

  selectedParticipantIds.value = selectedParticipantIds.value.filter((id) => id !== participantId);
  if (selectedParticipantId.value === participantId) {
    const nextPrimaryParticipantId = selectedParticipantIds.value[selectedParticipantIds.value.length - 1] ?? '';
    setPrimaryParticipant(nextPrimaryParticipantId);
  }
  selectedBlockId.value = null;
}

function selectBlock(participantId: string, blockId: string): void {
  if (!visibleParticipantIds.value.includes(participantId)) {
    visibleParticipantIds.value = [...visibleParticipantIds.value, participantId];
  }
  setPrimaryParticipant(participantId);
  selectedBlockId.value = blockId;
}

function selectPlaceBlock(blockId: string): void {
  selectedBlockId.value = blockId;
}

function selectTimelineRowBlock(row: TimelineDisplayRow, blockId: string): void {
  if (row.kind === 'place') {
    selectPlaceBlock(blockId);
    return;
  }
  selectBlock(row.id, blockId);
}

function clearSelectedBlockOnTimelineEmptyClick(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest('.schedule-block')) {
    return;
  }
  selectedBlockId.value = null;
}

function clearSelectedBlockOutsideTimeline(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest('.timeline-shell')) {
    return;
  }
  selectedBlockId.value = null;
}

function buildRoomAvailabilityFilter(date: string): Record<string, unknown> {
  return {
    дата: JSON.stringify({
      cutRangeByDate: false,
      fieldType: 3,
      type: 'equal',
      value: `${date}T00:00:00.000`
    })
  };
}

function readCurrentPulseUser(): { employeeId: string; displayName: string } {
  const fromStorage = readStoredCurrentUser();
  if (fromStorage.employeeId || fromStorage.displayName) {
    return fromStorage;
  }

  return { employeeId: '', displayName: '' };
}

function readStoredCurrentUser(): { employeeId: string; displayName: string } {
  const storageKeys = [
    'trickPlus.eventPlanning.currentUser',
    'pulse.currentUser',
    'currentUser',
    'user'
  ];

  for (const key of storageKeys) {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      continue;
    }

    try {
      const value = JSON.parse(rawValue);
      const employeeId = readEmployeeIdFromObject(value);
      const displayName = readDisplayNameFromObject(value);
      if (employeeId || displayName) {
        return { employeeId, displayName };
      }
    } catch {
      // Ignore unrelated localStorage values.
    }
  }

  return { employeeId: '', displayName: '' };
}

function readEmployeeIdFromObject(value: unknown): string {
  const object = readPlainObject(value);
  if (!object) {
    return '';
  }

  const directKeys = [
    'employeeId',
    'employee_id',
    'employeeRecordId',
    'recordId',
    'personId',
    'staffId',
    'пользовательНомерЗаписи',
    'сотрудник',
    'номерЗаписи'
  ];

  for (const key of directKeys) {
    const id = readPositiveId(object[key]);
    if (id) {
      return id;
    }
  }

  for (const key of ['employee', 'staff', 'person', 'profile', 'сотрудник', 'пользователь']) {
    const id = readEmployeeIdFromObject(object[key]);
    if (id) {
      return id;
    }
  }

  return '';
}

function readDisplayNameFromObject(value: unknown): string {
  const object = readPlainObject(value);
  if (!object) {
    return '';
  }

  for (const key of ['displayName', 'name', 'fullName', 'preferred_username', 'фио', 'фиократко']) {
    const name = typeof object[key] === 'string' ? object[key].trim() : '';
    if (name) {
      return name;
    }
  }

  return '';
}

function readPositiveId(value: unknown): string {
  const id = typeof value === 'number' && Number.isInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  return /^\d+$/.test(id) && Number(id) > 0 ? id : '';
}

function readPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

</script>

<template>
  <div class="page planning-page">
    <div class="planning-titlebar">
      <h1>Мастер планирования</h1>
    </div>

    <v-alert v-if="pulseErrorMessage" class="planning-alert" type="warning" density="compact" variant="tonal">
      {{ pulseErrorMessage }}
    </v-alert>

    <div class="planning-workspace">
      <section class="workspace-panel schedule-panel">
        <div class="schedule-heading">
          <div class="quick-plan-grid schedule-controls">
            <v-menu
              v-model="dateMenu"
              :close-on-content-click="false"
              content-class="planning-date-menu"
              location="bottom start"
              offset="4"
              transition="planning-date-menu-transition"
            >
              <template #activator="{ props }">
                <button
                  type="button"
                  class="planning-filter-button planning-date-button active"
                  v-bind="props"
                >
                  <span class="planning-filter-name">Дата:</span>
                  <span class="planning-filter-value planning-date-value">{{ selectedDateTitle }}</span>
                  <span class="planning-filter-icon" aria-hidden="true">
                    <v-icon icon="mdi-calendar-month-outline" size="16" />
                  </span>
                </button>
              </template>
              <div class="planning-stack-date-picker" datacy="date-picker">
                <div class="planning-picker-title">
                  <div class="planning-date-picker-title">
                    <button
                      type="button"
                      class="planning-picker-title-btn planning-date-picker-title-year"
                      :class="{ active: datePickerView === 'years' }"
                      @click="toggleCalendarYearPicker"
                    >
                      {{ datePickerYearTitle }}
                    </button>
                    <button
                      type="button"
                      class="planning-picker-title-btn planning-date-picker-title-date"
                      @click="resetCalendarToSelectedDate"
                    >
                      {{ datePickerDateTitle }}
                    </button>
                  </div>
                </div>

                <div class="planning-picker-body">
                  <div>
                    <div class="planning-date-picker-header">
                      <button
                        type="button"
                        class="planning-calendar-nav"
                        aria-label="Предыдущий месяц"
                        @click="moveDatePickerPage(-1)"
                      >
                        <span class="planning-calendar-nav-content">
                          <span aria-hidden="true" class="planning-calendar-nav-icon">
                            <svg aria-hidden="true" role="img" viewBox="0 0 24 24" class="planning-calendar-nav-svg">
                              <path d="M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z" />
                            </svg>
                          </span>
                        </span>
                      </button>

                      <div class="planning-date-picker-header-value">
                        <div>
                          <button
                            type="button"
                            :class="{ active: datePickerView === 'months' }"
                            @click="toggleCalendarMonthPicker"
                          >
                            {{ datePickerMonthTitle }}
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        class="planning-calendar-nav"
                        aria-label="Следующий месяц"
                        @click="moveDatePickerPage(1)"
                      >
                        <span class="planning-calendar-nav-content">
                          <span aria-hidden="true" class="planning-calendar-nav-icon">
                            <svg aria-hidden="true" role="img" viewBox="0 0 24 24" class="planning-calendar-nav-svg">
                              <path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z" />
                            </svg>
                          </span>
                        </span>
                      </button>
                    </div>

                    <div class="planning-calendar-view-frame" :class="`planning-calendar-view-frame--${datePickerView}`">
                      <Transition :name="datePickerTransitionName" mode="out-in">
                        <div :key="datePickerViewKey" class="planning-calendar-view-pane">
                          <div v-if="datePickerView === 'dates'" class="planning-date-picker-table">
                            <table>
                              <thead>
                                <tr>
                                  <th v-for="dayLabel in calendarWeekDays" :key="dayLabel">{{ dayLabel }}</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr v-for="(row, rowIndex) in datePickerRows" :key="rowIndex">
                                  <td v-for="day in row" :key="day.key">
                                    <button
                                      type="button"
                                      class="planning-calendar-day"
                                      :class="{
                                        'planning-calendar-day--disabled': day.disabled,
                                        'planning-calendar-day--selected': day.selected,
                                        'planning-calendar-day--today': day.today && !day.selected
                                      }"
                                      :disabled="day.disabled"
                                      @click="selectCalendarDate(day)"
                                    >
                                      <div class="planning-calendar-day-content">{{ day.label }}</div>
                                    </button>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          <div v-else-if="datePickerView === 'months'" class="planning-calendar-month-grid">
                            <button
                              v-for="month in datePickerMonthItems"
                              :key="month.index"
                              type="button"
                              class="planning-calendar-choice planning-calendar-month-choice"
                              :class="{ selected: month.selected }"
                              @click="selectCalendarMonth(month.index)"
                            >
                              {{ month.label }}
                            </button>
                          </div>

                          <div v-else class="planning-calendar-year-list">
                            <button
                              v-for="year in datePickerYearItems"
                              :key="year"
                              type="button"
                              class="planning-calendar-choice planning-calendar-year-choice"
                              :class="{ selected: year === datePickerMonth.getFullYear() }"
                              @click="selectCalendarYear(year)"
                            >
                              {{ year }}
                            </button>
                          </div>
                        </div>
                      </Transition>
                    </div>
                  </div>
                </div>

                <div class="planning-picker-actions">
                  <div class="planning-picker-actions-row">
                    <button
                      type="button"
                      class="planning-today-button"
                      @click="selectTodayDate"
                    >
                      <span class="planning-today-button-content">Сегодня {{ todayDateTitle }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </v-menu>

            <PlanningDropdown
              :model-value="visibleParticipantIds"
              label="Участники"
              :items="participantSelectItems"
              :multiple="true"
              :reset-value="defaultParticipantIds"
              :has-more="participantFilterHasMore"
              :loading="participantFilterLoading"
              :loading-more="participantFilterLoadingMore"
              :remote-search="true"
              :width="320"
              @load-more="loadMoreParticipants"
              @search-change="setParticipantSearch"
              @close="resetLoadedParticipantPages"
              @update:model-value="setParticipantFilterFromDropdown"
            >
              <template #item="{ item }">
                <span class="avatar small">
                  <img
                    v-if="item.avatarUrl"
                    :src="item.avatarUrl"
                    :alt="item.title"
                    loading="lazy"
                    decoding="async"
                  >
                  <span v-else>{{ initials(item.title) }}</span>
                </span>
                <span class="participant-filter-main">
                  <strong>{{ item.title }}</strong>
                </span>
              </template>
            </PlanningDropdown>

            <PlanningDropdown
              :model-value="eventDuration"
              label="Длительность"
              :items="durationItems"
              :reset-value="null"
              :grouped="false"
              :searchable="false"
              :show-apply="false"
              :width="320"
              placeholder="Не указана"
              @update:model-value="setDurationFromDropdown"
            />

            <PlanningDropdown
              :model-value="selectedPlaceIds"
              label="Место"
              :items="placeSelectItems"
              :multiple="true"
              :reset-value="[]"
              :searchable="false"
              :width="320"
              @update:model-value="setPlaceFromDropdown"
            />

            <PlanningDropdown
              :model-value="visibleDisplayFilters"
              label="Показывать"
              :items="displayFilterItems"
              :multiple="true"
              :reset-value="allDisplayFilterValues"
              :searchable="false"
              :width="320"
              @update:model-value="setDisplayFiltersFromDropdown"
            />

          </div>
        </div>

        <div class="timeline-shell">
          <div class="timeline-left-header">
            <div class="timeline-corner" aria-hidden="true" />
            <div class="timeline-control-corner" aria-hidden="true" />
          </div>

          <div
            ref="timelineHeaderScroll"
            class="timeline-header-scroll"
            @scroll="syncTimelineHorizontalScroll('header')"
          >
            <div class="timeline-horizontal-content" :style="timelineGridStyle">
              <span
                v-if="currentTimeVisible"
                class="timeline-current-time-line timeline-current-time-line--header"
                :style="currentTimeLineStyle"
                aria-hidden="true"
              />
              <div class="timeline-header">
                <div v-for="hour in hourColumns" :key="hour" class="timeline-hour">
                  {{ formatHour(hour) }}
                </div>
              </div>
              <div class="timeline-control-row">
                <div
                  ref="timelineScaleLayer"
                  class="timeline-scale-layer"
                  :class="selectedIntervalStateClass"
                >
                  <span
                    v-if="currentTimeVisible"
                    class="timeline-current-time-line timeline-current-time-line--scale"
                    :style="currentTimeLineStyle"
                    aria-hidden="true"
                  />
                  <span class="timeline-locked-range timeline-locked-start" :style="timelineLockedStartStyle" />
                  <span class="timeline-locked-range timeline-locked-end" :style="timelineLockedEndStyle" />
                  <template v-if="hasEventDuration">
                    <span
                      class="timeline-interval-range"
                      :class="selectedIntervalStateClass"
                      :style="selectedIntervalStyle"
                    />
                    <span
                      class="timeline-range-hit-area"
                      :style="selectedIntervalStyle"
                      @pointerdown.stop="startTimelineRangeDrag"
                    />
                    <span
                      class="timeline-resize-hit-area"
                      :style="selectedIntervalStartHandleStyle"
                      @pointerdown.stop="startTimelineDrag('start', $event)"
                    />
                    <span
                      class="timeline-resize-hit-area"
                      :style="selectedIntervalEndHandleStyle"
                      @pointerdown.stop="startTimelineDrag('end', $event)"
                    />
                    <span class="timeline-selection-line" :class="selectedIntervalStateClass" :style="selectedIntervalStartStyle" />
                    <span class="timeline-selection-line" :class="selectedIntervalStateClass" :style="selectedIntervalEndStyle" />
                    <span
                      class="timeline-handle"
                      :class="[selectedIntervalStateClass, { active: activeTimelineHandle === 'start' }]"
                      :style="selectedIntervalStartHandleStyle"
                    >
                      <span>{{ eventForm.start }}</span>
                    </span>
                    <span
                      class="timeline-handle"
                      :class="[selectedIntervalStateClass, { active: activeTimelineHandle === 'end' }]"
                      :style="selectedIntervalEndHandleStyle"
                    >
                      <span>{{ eventForm.end }}</span>
                    </span>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <div class="timeline-body-scroll">
            <div class="timeline-body-grid">
              <div class="timeline-left-rows" :style="timelineRowsGridStyle">
                <div
                  v-for="row in visibleTimelineRows"
                  :key="`label-${row.key}`"
                  class="timeline-left-row"
                  :class="{
                    'timeline-place-row': row.kind === 'place',
                    selected: row.selected,
                    loading: row.loading,
                    'has-error': row.error
                  }"
                  :style="timelineRowStyle(row)"
                  :title="row.error || undefined"
                >
                  <div v-if="row.kind === 'place'" class="timeline-person timeline-place-person">
                    <span class="timeline-place-name">
                      <strong>{{ row.name }}</strong>
                    </span>
                  </div>
                  <button
                    v-else
                    type="button"
                    class="timeline-person"
                    :aria-pressed="row.selected"
                    @click="toggleParticipantSelection(row.id)"
                  >
                    <span class="avatar small">
                      <img
                        v-if="row.avatarUrl"
                        :src="row.avatarUrl"
                        :alt="row.name"
                        loading="lazy"
                        decoding="async"
                      >
                      <span v-else>{{ initials(row.name) }}</span>
                    </span>
                    <span class="timeline-person-name">
                      <span
                        v-for="(namePart, namePartIndex) in timelinePersonNameParts(row.name)"
                        :key="`${row.id}-${namePartIndex}`"
                      >
                        {{ namePart }}
                      </span>
                    </span>
                    <span
                      v-if="row.hasBirthday"
                      class="timeline-person-birthday"
                      title="День рождения"
                      aria-label="День рождения"
                    >
                      <v-icon icon="mdi-cake-variant-outline" size="16" />
                    </span>
                  </button>
                </div>
              </div>

              <div
                ref="timelineBodyScroll"
                class="timeline-body-horizontal-scroll"
                @scroll="syncTimelineHorizontalScroll('body')"
              >
                <div class="timeline-horizontal-content timeline-body-rows" :style="[timelineGridStyle, timelineRowsGridStyle]">
                  <span
                    v-if="currentTimeVisible"
                    class="timeline-current-time-line timeline-current-time-line--body"
                    :style="currentTimeLineStyle"
                    aria-hidden="true"
                  />
                  <div
                    v-for="row in visibleTimelineRows"
                    :key="`track-${row.key}`"
                    class="timeline-track-row"
                    :class="{
                    'timeline-place-row': row.kind === 'place',
                    selected: row.selected,
                    loading: row.loading,
                    'has-error': row.error
                  }"
                  :style="timelineRowStyle(row)"
                  :title="row.error || undefined"
                >
                    <div class="timeline-track" @click="clearSelectedBlockOnTimelineEmptyClick">
                      <template v-if="row.kind === 'participant' && row.workSchedule">
                        <span
                          class="timeline-employee-offtime timeline-employee-offtime-start"
                          :style="workScheduleStartOfftimeStyle(row.workSchedule)"
                        />
                        <span
                          class="timeline-employee-offtime timeline-employee-offtime-end"
                          :style="workScheduleEndOfftimeStyle(row.workSchedule)"
                        />
                        <span
                          class="timeline-work-boundary timeline-work-boundary-start"
                          :style="workScheduleStartBoundaryStyle(row.workSchedule)"
                        />
                        <span
                          class="timeline-work-boundary timeline-work-boundary-end"
                          :style="workScheduleEndBoundaryStyle(row.workSchedule)"
                        />
                      </template>
                      <span class="timeline-locked-range" :style="timelineLockedStartStyle" />
                      <span class="timeline-locked-range" :style="timelineLockedEndStyle" />
                      <template v-if="hasEventDuration">
                        <span class="timeline-interval-range" :class="selectedIntervalStateClass" :style="selectedIntervalStyle" />
                        <span class="timeline-selection-line" :class="selectedIntervalStateClass" :style="selectedIntervalStartStyle" />
                        <span class="timeline-selection-line" :class="selectedIntervalStateClass" :style="selectedIntervalEndStyle" />
                      </template>
                      <span v-for="line in gridLines" :key="line" class="timeline-line" :style="{ left: `${line}%` }" />
                      <button
                        v-for="block in timelineRowBlocks(row)"
                        :key="timelineBlockKey(row, block)"
                        type="button"
                        class="schedule-block"
                        :class="[block.type, { selected: block.id === selectedBlockId }]"
                        :style="blockStyle(block)"
                        @click="selectTimelineRowBlock(row, block.id)"
                      >
                        <span class="block-title">{{ block.title }}</span>
                        <span class="block-time">{{ formatBlockTime(block) }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

  </div>
</template>
