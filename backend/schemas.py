from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import datetime

# ================= AUTH & USERS ================= #

class LoginRequest(BaseModel):
    username_or_id: Optional[str] = None
    username: Optional[str] = None
    password: str

class UserOut(BaseModel):
    id: int
    employee_id: str
    name: str
    username: str
    phone: Optional[str] = None
    email: Optional[str] = None
    role: str
    salary_type: str
    salary_rate: float
    assigned_shift_id: Optional[int] = None
    assigned_shift_name: Optional[str] = None
    joining_date: Optional[str] = None
    status: str
    class Config:
        from_attributes = True

class LoginResponse(BaseModel):
    token: str
    user: UserOut

class EmployeeCreate(BaseModel):
    employee_id: str
    name: str
    username: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    password: str
    role: str = "EMPLOYEE"
    salary_type: str = "MONTHLY" # "MONTHLY", "DAILY", "HOURLY"
    salary_rate: float = 18000.0
    assigned_shift_id: Optional[int] = None
    joining_date: Optional[str] = None
    status: str = "ACTIVE"

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    salary_type: Optional[str] = None
    salary_rate: Optional[float] = None
    assigned_shift_id: Optional[int] = None
    status: Optional[str] = None

# ================= SHIFTS & ATTENDANCE ================= #

class WorkShiftCreate(BaseModel):
    name: str
    start_time: str
    end_time: str
    description: Optional[str] = None
    is_active: bool = True

class WorkShiftOut(BaseModel):
    id: int
    name: str
    start_time: str
    end_time: str
    description: Optional[str] = None
    is_active: bool
    class Config:
        from_attributes = True

class AttendanceCheckInRequest(BaseModel):
    shift_id: Optional[int] = None
    notes: Optional[str] = None

class AttendanceCheckOutRequest(BaseModel):
    notes: Optional[str] = None

class AttendanceOut(BaseModel):
    id: int
    employee_id: int
    employee_code: str
    employee_name: str
    shift_id: Optional[int] = None
    shift_name: str
    date: str
    check_in_time: str
    check_out_time: Optional[str] = None
    working_minutes: int
    late_minutes: int
    status: str
    bills_count: int
    total_sales: float
    cash_sales: float
    upi_sales: float
    card_sales: float
    items_sold: int
    notes: Optional[str] = None

# ================= SALARIES ================= #

class SalaryPayRequest(BaseModel):
    salary_record_id: int
    payment_method: str = "CASH" # "CASH", "UPI", "BANK_TRANSFER"
    payment_reference: Optional[str] = None
    notes: Optional[str] = None

class SalaryRecordOut(BaseModel):
    id: int
    employee_id: int
    employee_code: str
    employee_name: str
    month_year: str
    salary_type: str
    salary_rate: float
    present_days: int
    absent_days: int
    late_days: int
    total_working_hours: float
    calculated_salary: float
    paid_amount: float
    payment_status: str
    payment_date: Optional[str] = None
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    notes: Optional[str] = None

# ================= CATEGORIES & PRODUCTS ================= #

class CategoryBase(BaseModel):
    name: str
    icon: Optional[str] = "package"
    color: Optional[str] = "emerald"

class CategoryOut(CategoryBase):
    id: int
    class Config:
        from_attributes = True

class ProductBase(BaseModel):
    barcode: str
    sku: str
    name: str
    category: str
    brand: Optional[str] = "Generic"
    unit: Optional[str] = "pcs"
    cost_price: float = 0.0
    selling_price: float
    mrp: float
    tax_rate: float = 0.0
    stock_qty: float = 0.0
    min_stock: float = 10.0
    rack_location: Optional[str] = "A-01"
    image_url: Optional[str] = None
    is_active: bool = True
    supplier_id: Optional[int] = None
    has_batch: Optional[bool] = False
    default_expiry_days: Optional[int] = None

class ProductCreate(ProductBase):
    pass

class ProductUpdate(BaseModel):
    barcode: Optional[str] = None
    sku: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    unit: Optional[str] = None
    cost_price: Optional[float] = None
    selling_price: Optional[float] = None
    mrp: Optional[float] = None
    tax_rate: Optional[float] = None
    stock_qty: Optional[float] = None
    min_stock: Optional[float] = None
    rack_location: Optional[str] = None
    image_url: Optional[str] = None
    is_active: Optional[bool] = None
    supplier_id: Optional[int] = None
    has_batch: Optional[bool] = None
    default_expiry_days: Optional[int] = None

class ProductOut(ProductBase):
    id: int
    created_at: Optional[datetime.datetime] = None
    updated_at: Optional[datetime.datetime] = None
    class Config:
        from_attributes = True

# ================= CUSTOMERS ================= #

class CustomerBase(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    loyalty_points: Optional[int] = 0
    tier: Optional[str] = "Bronze"
    credit_balance: Optional[float] = 0.0

class CustomerCreate(CustomerBase):
    pass

class CustomerOut(CustomerBase):
    id: int
    total_spent: float
    visits_count: int
    created_at: datetime.datetime
    class Config:
        from_attributes = True

# ================= BILLING & ORDERS ================= #

class OrderItemRequest(BaseModel):
    product_id: int
    barcode: Optional[str] = ""
    product_name: Optional[str] = None
    name: Optional[str] = None
    quantity: float
    unit: str = "pcs"
    unit_price: Optional[float] = None
    price: Optional[float] = None
    mrp: Optional[float] = 0.0
    cost_price: Optional[float] = 0.0
    tax_rate: Optional[float] = None
    tax_percent: Optional[float] = None
    discount_amount: Optional[float] = 0.0
    total_price: Optional[float] = 0.0

class CheckoutRequest(BaseModel):
    customer_id: Optional[int] = None
    customer_name: Optional[str] = "Walk-in Customer"
    customer_phone: Optional[str] = None
    employee_id: Optional[str] = "EMP001"
    cashier_name: Optional[str] = "Ravi Kumar"
    register_number: Optional[str] = "REG-01"
    shift_id: Optional[int] = None
    attendance_id: Optional[int] = None
    subtotal: Optional[float] = None
    tax_amount: Optional[float] = 0.0
    tax_total: Optional[float] = 0.0
    discount_amount: Optional[float] = 0.0
    discount_total: Optional[float] = 0.0
    coupon_code: Optional[str] = None
    points_redeemed: Optional[int] = 0
    points_discount: Optional[float] = 0.0
    round_off: Optional[float] = 0.0
    grand_total: Optional[float] = None
    payment_method: Optional[str] = None
    payment_mode: Optional[str] = None
    amount_paid: Optional[float] = None
    tendered_amount: Optional[float] = None
    change_amount: Optional[float] = 0.0
    counter_id: Optional[str] = "Counter 1"
    payment_details: Optional[dict] = None
    transaction_ref: Optional[str] = None
    items: List[OrderItemRequest]

class HoldCartRequest(BaseModel):
    customer_name: Optional[str] = "Walk-in Customer"
    customer_phone: Optional[str] = None
    items: List[dict]
    notes: Optional[str] = None

class ShiftOpenRequest(BaseModel):
    cashier_name: str
    register_number: Optional[str] = "REG-01"
    opening_cash: float

class ShiftCloseRequest(BaseModel):
    actual_cash: float
    notes: Optional[str] = None

class CashMovementRequest(BaseModel):
    shift_id: int
    movement_type: str
    amount: float
    reason: str

# ================= SUPPLIERS & PURCHASES ================= #

class SupplierCreate(BaseModel):
    name: str
    contact_person: Optional[str] = None
    phone: str
    email: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None
    company_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    payment_terms: Optional[str] = None
    bank_details: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = "ACTIVE"

class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None
    company_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    payment_terms: Optional[str] = None
    bank_details: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None

class SupplierOut(BaseModel):
    id: int
    name: str
    contact_person: Optional[str] = None
    phone: str
    email: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None
    is_active: bool
    company_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    payment_terms: Optional[str] = None
    bank_details: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = "ACTIVE"
    created_at: Optional[datetime.datetime] = None
    class Config:
        from_attributes = True

class PurchaseItemCreate(BaseModel):
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    quantity: float = 0.0
    purchase_price: float = 0.0
    gst_rate: Optional[float] = 0.0
    discount_amount: Optional[float] = 0.0
    # Legacy field aliases
    qty: Optional[float] = None
    cost_price: Optional[float] = None
    selling_price: Optional[float] = None

class PurchaseOrderCreate(BaseModel):
    supplier_id: int
    invoice_number: Optional[str] = None
    supplier_invoice_number: Optional[str] = None
    purchase_date: Optional[str] = None
    total_amount: Optional[float] = None
    tax_amount: Optional[float] = 0.0
    discount_amount: Optional[float] = 0.0
    paid_amount: Optional[float] = 0.0
    notes: Optional[str] = None
    items: List[dict]

class PurchaseReceiveItem(BaseModel):
    product_id: int
    received_qty: float

class PurchaseReceiveRequest(BaseModel):
    items: List[PurchaseReceiveItem]
    notes: Optional[str] = None

class SupplierPaymentCreate(BaseModel):
    supplier_id: int
    purchase_order_id: Optional[int] = None
    amount: float
    payment_date: str
    payment_method: Optional[str] = "CASH"
    reference_number: Optional[str] = None
    notes: Optional[str] = None

# ================= SALES RETURNS ================= #

class SalesReturnItemCreate(BaseModel):
    product_id: int
    returned_quantity: float
    unit_price: Optional[float] = None
    restock_condition: Optional[str] = "GOOD" # "GOOD" or "DAMAGED"

class SalesReturnCreate(BaseModel):
    invoice_number: str
    refund_method: Optional[str] = "CASH"
    reason: str
    notes: Optional[str] = None
    items: List[SalesReturnItemCreate]

# ================= PURCHASE RETURNS ================= #

class PurchaseReturnItemCreate(BaseModel):
    product_id: int
    returned_quantity: float
    unit_price: Optional[float] = None

class PurchaseReturnCreate(BaseModel):
    purchase_order_id: Optional[int] = None
    po_number: Optional[str] = None
    supplier_id: int
    reason: str
    notes: Optional[str] = None
    items: List[PurchaseReturnItemCreate]

# ================= BATCHES ================= #

class ProductBatchCreate(BaseModel):
    product_id: int
    batch_number: str
    mfg_date: Optional[str] = None
    expiry_date: str
    quantity: float
    cost_price: Optional[float] = 0.0
    selling_price: Optional[float] = 0.0
    supplier_id: Optional[int] = None
    purchase_order_id: Optional[int] = None

# ================= PROMOTIONS ================= #

class PromotionCreate(BaseModel):
    code: str
    title: str
    description: Optional[str] = None
    discount_type: str = "PERCENTAGE" # PERCENTAGE, FIXED, BOGO
    discount_value: float
    min_bill_amount: Optional[float] = 0.0
    max_discount_amount: Optional[float] = None
    product_id: Optional[int] = None
    category_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    usage_limit: Optional[int] = None
    is_active: Optional[bool] = True

class PromotionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    discount_type: Optional[str] = None
    discount_value: Optional[float] = None
    min_bill_amount: Optional[float] = None
    max_discount_amount: Optional[float] = None
    product_id: Optional[int] = None
    category_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    usage_limit: Optional[int] = None
    is_active: Optional[bool] = None

class ApplyCouponRequest(BaseModel):
    coupon_code: str
    bill_subtotal: float
    items: Optional[List[dict]] = None

# ================= AUDIT LOG ================= #

class AuditLogCreate(BaseModel):
    action: str
    entity: Optional[str] = None
    entity_id: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    details: Optional[str] = None

# ================= AI ASSISTANT ================= #

class AiQueryRequest(BaseModel):
    query: str

# ================= BACKUP & RESTORE ================= #

class RestoreBackupRequest(BaseModel):
    filename: str
    confirm: bool
