import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(String(50), unique=True, index=True, nullable=False) # e.g. "EMP001", "owner"
    name = Column(String(150), nullable=False) # e.g. "Ravi Kumar"
    username = Column(String(100), unique=True, index=True, nullable=False)
    phone = Column(String(20), nullable=True)
    email = Column(String(100), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), default="EMPLOYEE", nullable=False) # "OWNER", "EMPLOYEE"
    
    # Salary Details
    salary_type = Column(String(20), default="MONTHLY") # "MONTHLY", "DAILY", "HOURLY"
    salary_rate = Column(Float, default=18000.0) # Rate in INR
    
    # Shift Assignment
    assigned_shift_id = Column(Integer, ForeignKey("work_shifts.id"), nullable=True)
    joining_date = Column(String(20), default=lambda: datetime.date.today().strftime("%Y-%m-%d"))
    status = Column(String(20), default="ACTIVE") # "ACTIVE", "INACTIVE"
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    assigned_shift = relationship("WorkShift", back_populates="employees")
    attendances = relationship("Attendance", back_populates="employee", cascade="all, delete-orphan")
    salary_records = relationship("SalaryRecord", back_populates="employee", cascade="all, delete-orphan")

class WorkShift(Base):
    __tablename__ = "work_shifts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False) # "Morning Shift", "Evening Shift", "Night Shift"
    start_time = Column(String(10), nullable=False) # "08:00"
    end_time = Column(String(10), nullable=False) # "16:00"
    description = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)

    employees = relationship("User", back_populates="assigned_shift")
    attendances = relationship("Attendance", back_populates="shift")

class Attendance(Base):
    __tablename__ = "attendances"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    employee_code = Column(String(50), nullable=False) # "EMP001"
    employee_name = Column(String(150), nullable=False)
    shift_id = Column(Integer, ForeignKey("work_shifts.id"), nullable=True)
    shift_name = Column(String(100), default="General Shift")
    date = Column(String(20), default=lambda: datetime.date.today().strftime("%Y-%m-%d"), index=True)
    
    check_in_time = Column(DateTime, default=datetime.datetime.utcnow)
    check_out_time = Column(DateTime, nullable=True)
    working_minutes = Column(Integer, default=0)
    late_minutes = Column(Integer, default=0)
    status = Column(String(20), default="WORKING") # "WORKING", "COMPLETED", "ABSENT"
    
    # Billing shift summary created during this check-in session
    bills_count = Column(Integer, default=0)
    total_sales = Column(Float, default=0.0)
    cash_sales = Column(Float, default=0.0)
    upi_sales = Column(Float, default=0.0)
    card_sales = Column(Float, default=0.0)
    items_sold = Column(Integer, default=0)
    notes = Column(Text, nullable=True)

    employee = relationship("User", back_populates="attendances")
    shift = relationship("WorkShift", back_populates="attendances")

class SalaryRecord(Base):
    __tablename__ = "salary_records"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    employee_code = Column(String(50), nullable=False)
    employee_name = Column(String(150), nullable=False)
    month_year = Column(String(20), nullable=False, index=True) # "2026-10"
    
    salary_type = Column(String(20), default="MONTHLY")
    salary_rate = Column(Float, default=0.0)
    
    present_days = Column(Integer, default=0)
    absent_days = Column(Integer, default=0)
    late_days = Column(Integer, default=0)
    total_working_hours = Column(Float, default=0.0)
    
    calculated_salary = Column(Float, nullable=False)
    paid_amount = Column(Float, default=0.0)
    payment_status = Column(String(20), default="PENDING") # "PENDING", "PAID"
    payment_date = Column(DateTime, nullable=True)
    payment_method = Column(String(50), nullable=True) # "CASH", "UPI", "BANK_TRANSFER"
    payment_reference = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)

    employee = relationship("User", back_populates="salary_records")

class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    icon = Column(String(50), default="package")
    color = Column(String(50), default="emerald")

class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    barcode = Column(String(50), unique=True, index=True, nullable=False)
    sku = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(200), index=True, nullable=False)
    category = Column(String(100), index=True, nullable=False)
    brand = Column(String(100), default="Generic")
    unit = Column(String(20), default="pcs")
    cost_price = Column(Float, default=0.0)
    selling_price = Column(Float, nullable=False)
    mrp = Column(Float, nullable=False)
    tax_rate = Column(Float, default=0.0)
    stock_qty = Column(Float, default=0.0)
    min_stock = Column(Float, default=10.0)
    rack_location = Column(String(50), default="A-01")
    image_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    has_batch = Column(Boolean, default=False)
    default_expiry_days = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    batches = relationship("ProductBatch", back_populates="product", cascade="all, delete-orphan")
    stock_movements = relationship("StockMovement", back_populates="product", cascade="all, delete-orphan")

class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    phone = Column(String(20), unique=True, index=True, nullable=False)
    email = Column(String(100), nullable=True)
    loyalty_points = Column(Integer, default=0)
    tier = Column(String(20), default="Bronze")
    credit_balance = Column(Float, default=0.0)
    total_spent = Column(Float, default=0.0)
    visits_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    orders = relationship("Order", back_populates="customer")

class Shift(Base):
    __tablename__ = "shifts"

    id = Column(Integer, primary_key=True, index=True)
    cashier_name = Column(String(100), nullable=False)
    register_number = Column(String(50), default="REG-01")
    opened_at = Column(DateTime, default=datetime.datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)
    opening_cash = Column(Float, default=0.0)
    closing_cash = Column(Float, nullable=True)
    expected_cash = Column(Float, default=0.0)
    actual_cash = Column(Float, nullable=True)
    cash_difference = Column(Float, default=0.0)
    total_sales = Column(Float, default=0.0)
    total_transactions = Column(Integer, default=0)
    status = Column(String(20), default="OPEN")
    notes = Column(Text, nullable=True)

    orders = relationship("Order", back_populates="shift")
    cash_movements = relationship("CashMovement", back_populates="shift")

class CashMovement(Base):
    __tablename__ = "cash_movements"

    id = Column(Integer, primary_key=True, index=True)
    shift_id = Column(Integer, ForeignKey("shifts.id"), nullable=False)
    movement_type = Column(String(20), nullable=False)
    amount = Column(Float, nullable=False)
    reason = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    shift = relationship("Shift", back_populates="cash_movements")

class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    invoice_number = Column(String(50), unique=True, index=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    customer_name = Column(String(150), default="Walk-in Customer")
    customer_phone = Column(String(20), nullable=True)
    
    # Employee / Cashier linkage
    employee_id = Column(String(50), default="EMP001", index=True)
    cashier_name = Column(String(100), default="Ravi Kumar")
    register_number = Column(String(50), default="REG-01")
    counter_id = Column(String(50), default="Counter 1")
    shift_id = Column(Integer, ForeignKey("shifts.id"), nullable=True)
    attendance_id = Column(Integer, ForeignKey("attendances.id"), nullable=True)
    
    subtotal = Column(Float, nullable=False)
    tax_amount = Column(Float, default=0.0)
    discount_amount = Column(Float, default=0.0)
    coupon_code = Column(String(50), nullable=True)
    points_redeemed = Column(Integer, default=0)
    points_discount = Column(Float, default=0.0)
    round_off = Column(Float, default=0.0)
    grand_total = Column(Float, nullable=False)
    
    payment_method = Column(String(50), default="CASH") # CASH, UPI, CARD, SPLIT, CREDIT
    tendered_amount = Column(Float, default=0.0)
    change_amount = Column(Float, default=0.0)
    payment_details = Column(Text, nullable=True)
    
    # Reprint tracking
    is_reprinted = Column(Boolean, default=False)
    reprint_count = Column(Integer, default=0)
    
    status = Column(String(20), default="COMPLETED")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    customer = relationship("Customer", back_populates="orders")
    shift = relationship("Shift", back_populates="orders")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")

class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product_name = Column(String(200), nullable=False)
    barcode = Column(String(50), nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String(20), default="pcs")
    unit_price = Column(Float, nullable=False)
    cost_price = Column(Float, default=0.0)
    tax_rate = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    discount_amount = Column(Float, default=0.0)
    total_price = Column(Float, nullable=False)

    order = relationship("Order", back_populates="items")
    product = relationship("Product")

class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    contact_person = Column(String(100), nullable=True)
    phone = Column(String(20), nullable=False)
    email = Column(String(100), nullable=True)
    address = Column(String(255), nullable=True)
    gstin = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True)
    # Extended fields (added via migration)
    company_name = Column(String(150), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    payment_terms = Column(String(255), nullable=True)
    bank_details = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(20), default='ACTIVE')
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    po_number = Column(String(50), unique=True, index=True, nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    invoice_number = Column(String(100), nullable=True)
    total_amount = Column(Float, nullable=False)
    tax_amount = Column(Float, default=0.0)
    status = Column(String(30), default="RECEIVED")
    items_json = Column(Text, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    # Extended fields (added via migration)
    paid_amount = Column(Float, default=0.0)
    due_amount = Column(Float, default=0.0)
    payment_status = Column(String(20), default='PENDING')  # PENDING, PARTIAL, PAID
    discount_amount = Column(Float, default=0.0)
    subtotal_amount = Column(Float, default=0.0)
    received_status = Column(String(20), default='PENDING')  # PENDING, PARTIAL, RECEIVED
    supplier_invoice_number = Column(String(100), nullable=True)
    purchase_date = Column(String(20), nullable=True)

    supplier = relationship("Supplier")

class SupplierPayment(Base):
    __tablename__ = "supplier_payments"
    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True)
    amount = Column(Float, nullable=False)
    payment_date = Column(String(20), nullable=False)
    payment_method = Column(String(50), default="CASH")  # CASH, UPI, CARD, BANK_TRANSFER, OTHER
    reference_number = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    supplier = relationship("Supplier")
    purchase_order = relationship("PurchaseOrder", foreign_keys=[purchase_order_id])

class HoldCart(Base):
    __tablename__ = "hold_carts"

    id = Column(Integer, primary_key=True, index=True)
    cart_ref = Column(String(50), unique=True, index=True, nullable=False)
    customer_name = Column(String(150), default="Walk-in Customer")
    customer_phone = Column(String(20), nullable=True)
    items_json = Column(Text, nullable=False)
    notes = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class StoreSetting(Base):
    __tablename__ = "store_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, nullable=False)

# ================= SALES & PURCHASE RETURNS ================= #

class SalesReturn(Base):
    __tablename__ = "sales_returns"

    id = Column(Integer, primary_key=True, index=True)
    return_number = Column(String(50), unique=True, index=True, nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    invoice_number = Column(String(50), index=True, nullable=False)
    customer_name = Column(String(150), default="Walk-in Customer")
    customer_phone = Column(String(20), nullable=True)
    employee_id = Column(String(50), default="EMP001")
    cashier_name = Column(String(100), default="Ravi Kumar")
    total_refund = Column(Float, nullable=False)
    refund_method = Column(String(50), default="CASH") # CASH, UPI, CREDIT
    reason = Column(String(255), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    items = relationship("SalesReturnItem", back_populates="sales_return", cascade="all, delete-orphan")
    order = relationship("Order")

class SalesReturnItem(Base):
    __tablename__ = "sales_return_items"

    id = Column(Integer, primary_key=True, index=True)
    sales_return_id = Column(Integer, ForeignKey("sales_returns.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product_name = Column(String(200), nullable=False)
    barcode = Column(String(50), nullable=False)
    returned_quantity = Column(Float, nullable=False)
    unit = Column(String(20), default="pcs")
    unit_price = Column(Float, nullable=False)
    refund_amount = Column(Float, nullable=False)
    restock_condition = Column(String(50), default="GOOD") # GOOD (restock), DAMAGED (do not restock)

    sales_return = relationship("SalesReturn", back_populates="items")
    product = relationship("Product")

class PurchaseReturn(Base):
    __tablename__ = "purchase_returns"

    id = Column(Integer, primary_key=True, index=True)
    return_number = Column(String(50), unique=True, index=True, nullable=False)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True)
    po_number = Column(String(50), index=True, nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    supplier_name = Column(String(150), nullable=False)
    total_refund = Column(Float, nullable=False)
    refund_method = Column(String(50), default="SUPPLIER_CREDIT")
    reason = Column(String(255), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    items = relationship("PurchaseReturnItem", back_populates="purchase_return", cascade="all, delete-orphan")
    supplier = relationship("Supplier")
    purchase_order = relationship("PurchaseOrder")

class PurchaseReturnItem(Base):
    __tablename__ = "purchase_return_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_return_id = Column(Integer, ForeignKey("purchase_returns.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product_name = Column(String(200), nullable=False)
    barcode = Column(String(50), nullable=True)
    returned_quantity = Column(Float, nullable=False)
    unit_price = Column(Float, nullable=False)
    refund_amount = Column(Float, nullable=False)

    purchase_return = relationship("PurchaseReturn", back_populates="items")
    product = relationship("Product")

# ================= STOCK LEDGER & MOVEMENT ================= #

class StockMovement(Base):
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product_name = Column(String(200), nullable=False)
    barcode = Column(String(50), nullable=False)
    movement_type = Column(String(50), nullable=False) # OPENING_STOCK, PURCHASE, SALE, SALES_RETURN, PURCHASE_RETURN, DAMAGE, ADJUSTMENT, EXPIRED, MANUAL
    quantity_change = Column(Float, nullable=False) # +ve or -ve
    balance_after = Column(Float, nullable=False)
    reference_type = Column(String(50), nullable=True) # ORDER, PURCHASE, SALES_RETURN, PURCHASE_RETURN, MANUAL, ADJUSTMENT
    reference_id = Column(String(100), nullable=True)
    reason = Column(String(255), nullable=True)
    user_name = Column(String(100), default="System")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    product = relationship("Product", back_populates="stock_movements")

# ================= BATCH & EXPIRY MANAGEMENT ================= #

class ProductBatch(Base):
    __tablename__ = "product_batches"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    batch_number = Column(String(100), nullable=False, index=True)
    mfg_date = Column(String(20), nullable=True)
    expiry_date = Column(String(20), nullable=True, index=True)
    quantity = Column(Float, default=0.0)
    cost_price = Column(Float, default=0.0)
    selling_price = Column(Float, default=0.0)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True)
    status = Column(String(20), default="ACTIVE") # ACTIVE, EXPIRED, EXHAUSTED
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    product = relationship("Product", back_populates="batches")
    supplier = relationship("Supplier")

# ================= PROMOTIONS & COUPONS ================= #

class Promotion(Base):
    __tablename__ = "promotions"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, index=True, nullable=False)
    title = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    discount_type = Column(String(20), default="PERCENTAGE") # PERCENTAGE, FIXED, BOGO
    discount_value = Column(Float, nullable=False)
    min_bill_amount = Column(Float, default=0.0)
    max_discount_amount = Column(Float, nullable=True)
    product_id = Column(Integer, nullable=True)
    category_name = Column(String(100), nullable=True)
    start_date = Column(String(20), nullable=True)
    end_date = Column(String(20), nullable=True)
    usage_limit = Column(Integer, nullable=True)
    used_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

# ================= AUDIT LOGGING ================= #

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=True)
    username = Column(String(100), nullable=True)
    employee_id = Column(String(50), nullable=True)
    role = Column(String(50), nullable=True)
    action = Column(String(100), nullable=False, index=True) # LOGIN, CHECKOUT, PRICE_CHANGE, STOCK_ADJUSTMENT, SALES_RETURN, PURCHASE_RETURN, COUPON_CREATE, BACKUP_RESTORE, SETTINGS_UPDATE
    entity = Column(String(100), nullable=True) # ORDER, PRODUCT, SUPPLIER, RETURN, PROMOTION, SETTINGS, SHIFT
    entity_id = Column(String(100), nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)
