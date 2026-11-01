export type Role = 'master' | 'admin' | 'user'

export interface Profile {
  id: string
  full_name: string
  role: Role
  store_id: string
  phone: string | null
  email: string
  active: boolean
  can_edit_points: boolean
  is_primary: boolean
  created_at: string
}

export interface Store {
  id: string
  name: string
  code: string | null
  address: string | null
  phone: string | null
  open_hours: string | null
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

export type ShiftType = 'open' | 'mid' | 'close' | 'custom' | 'repo' | 'adeia'

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
