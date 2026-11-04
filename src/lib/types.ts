export type Role = 'master' | 'admin' | 'user'

export interface Profile {
  id: string
  full_name: string
  role: Role
  store_id: string | null
  active_store_id: string | null
  phone: string | null
  email: string
  active: boolean
  can_edit_points: boolean
  is_primary: boolean
  is_seller: boolean
  deleted_at: string | null
  deleted_by: string | null
  pending_store_name: string | null
  pending_store_code: string | null
  created_at: string
}

export interface Store {
  id: string
  name: string
  code: string | null
  organization_id: string | null
  address: string | null
  phone: string | null
  open_hours: string | null
  fallback_work_days: string
  min_staff: number
  deleted_at: string | null
}

export interface Organization {
  id: string
  name: string
  created_by: string | null
  created_at: string
}

export interface StoreTarget {
  id: string
  store_id: string
  month: string
  store_points: number
  created_at: string
  updated_at: string
}

export interface EmployeeTarget {
  id: string
  store_id: string
  user_id: string
  month: string
  points: number
  projection: number
  created_at: string
  updated_at: string
}

export type OrderStatus =
  | 'new'
  | 'ordered'
  | 'in_transit'
  | 'received'
  | 'ready'
  | 'notified'
  | 'completed'
  | 'cancelled'

export interface Order {
  id: string
  store_id: string
  product_code: string
  product_name: string
  customer_name: string
  customer_phone: string | null
  notes: string | null
  status: OrderStatus
  created_by: string
  created_at: string
  updated_at: string
}

export interface OrderEvent {
  id: string
  order_id: string
  status: OrderStatus
  note: string | null
  actor_id: string
  created_at: string
}

export type ShiftType = 'open' | 'mid' | 'close' | 'custom' | 'repo' | 'adeia' | 'split' | 'short' | 'full'

export interface Shift {
  id: string
  store_id: string
  user_id: string
  date: string
  shift_type: ShiftType
  start_time: string | null
  end_time: string | null
  note: string | null
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveRequest {
  id: string
  store_id: string
  user_id: string
  type: 'repo' | 'adeia'
  start_date: string
  end_date: string
  reason: string | null
  status: LeaveStatus
  reviewed_by: string | null
  created_at: string
}

export interface ActivityLog {
  id: string
  store_id: string
  actor_id: string
  action: string
  detail: string | null
  created_at: string
}

export type AccountType = 'user' | 'admin'

export type CategoryUnit = 'count' | 'currency'

export interface ServiceCategory {
  id: string
  name: string
  unit: CategoryUnit
  active: boolean
  sort_order: number
}

export interface StoreCategory {
  store_id: string
  category_id: string
  active: boolean
  sort_order: number | null
}

export interface StoreCategoryTarget {
  id: string
  store_id: string
  category_id: string
  month: string
  target: number
}

export interface SellerCategoryTarget {
  id: string
  store_id: string
  user_id: string
  category_id: string
  month: string
  target: number
}

export interface SalesEntry {
  id: string
  store_id: string
  user_id: string
  category_id: string
  date: string
  quantity: number
  source: 'manual' | 'import'
  status: 'active' | 'cancelled'
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface StoreCalendarDay {
  id: string
  store_id: string
  date: string
  is_working: boolean
  note: string | null
  open_time: string | null
  close_time: string | null
}

export type PatternLevel = 'split' | 'short' | 'full'

export interface StorePattern {
  store_id: string
  weekday: number
  closed: boolean
  level: PatternLevel
  start_time: string | null
  end_time: string | null
  note: string | null
}

export type TaskStatus = 'pending' | 'in_progress' | 'done'
export type TaskRecurrence = 'daily' | 'weekly_days' | 'monthly_date' | 'every_n_days'

export interface TaskTemplate {
  id: string
  store_id: string
  title: string
  category: string | null
  recurrence: TaskRecurrence
  weekdays: number[]
  month_day: number | null
  every_n: number
  due_time: string | null
  requires_authorized: boolean
  active: boolean
  created_at: string
}

export interface StoreTask {
  id: string
  store_id: string
  template_id: string | null
  title: string
  category: string | null
  assigned_user_id: string | null
  scheduled_date: string
  due_time: string | null
  status: TaskStatus
  requires_authorized: boolean
  notes: string | null
  completed_at: string | null
  completed_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
