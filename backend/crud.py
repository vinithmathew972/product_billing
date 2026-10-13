import datetime
import json
import zoneinfo
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, or_, and_
from typing import Optional
from . import models, schemas
from .auth import hash_password

# ================= TIMEZONE & 12-HOUR FORMATTERS ================= #

IST_ZONE = zoneinfo.ZoneInfo("Asia/Kolkata")

def get_today_ist() -> datetime.date:
    """Return the current calendar date in Indian Standard Time (Asia/Kolkata)."""
    return datetime.datetime.now(IST_ZONE).date()

def get_now_utc() -> datetime.datetime:
    """Return the current datetime in UTC (timezone-aware)."""
    return datetime.datetime.now(datetime.timezone.utc)

def to_ist(dt: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """Convert any datetime (naive or aware) to Asia/Kolkata IST."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        # SQLite stores naive UTC timestamps
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(IST_ZONE)

def format_time_12h(dt_or_str) -> str:
    """
    Format any time representation into 12-hour AM/PM format (e.g. 9:30 AM, 1:15 PM, 6:45 PM).
    """
    if not dt_or_str:
        return "-"
    if isinstance(dt_or_str, datetime.datetime):
        dt_ist = to_ist(dt_or_str)
        return dt_ist.strftime("%I:%M %p").lstrip("0")
    if isinstance(dt_or_str, datetime.time):
        return dt_or_str.strftime("%I:%M %p").lstrip("0")
    
    val = str(dt_or_str).strip()
    if not val or val == "-" or val == "—" or val == "null" or val == "undefined":
        return "-"
    
    # If already formatted with AM/PM
    if "AM" in val or "PM" in val or "am" in val or "pm" in val:
        # If it also contains date (e.g. "2026-10-11 11:30 AM"), return just the time part
        parts = val.split()
        if len(parts) >= 2 and ("AM" in parts[-1] or "PM" in parts[-1] or "am" in parts[-1] or "pm" in parts[-1]):
            return f"{parts[-2]} {parts[-1]}"
        return val
    
    # If "HH:MM" or "HH:MM:SS" (e.g. shift definition "08:00", "16:00")
    if ":" in val and len(val) <= 8 and "-" not in val:
        try:
            parts = val.split(":")
            h = int(parts[0])
            m = int(parts[1])
            ampm = "PM" if h >= 12 else "AM"
            h = h % 12
            if h == 0:
                h = 12
            return f"{h}:{m:02d} {ampm}"
        except Exception:
            return val
            
    # If ISO string or SQLite timestamp "YYYY-MM-DD HH:MM:SS..."
    try:
        clean_str = val.replace("Z", "+00:00")
        dt = datetime.datetime.fromisoformat(clean_str)
        dt_ist = to_ist(dt)
        return dt_ist.strftime("%I:%M %p").lstrip("0")
    except Exception:
        pass
    return val

def format_datetime_12h(dt: Optional[datetime.datetime]) -> str:
    """Format datetime into YYYY-MM-DD hh:mm AM/PM in IST."""
    if not dt:
        return "-"
    if isinstance(dt, str):
        val = str(dt).strip()
        if ("AM" in val or "PM" in val) and "-" in val:
            return val
        try:
            dt_parsed = datetime.datetime.fromisoformat(val.replace("Z", "+00:00"))
            return format_datetime_12h(dt_parsed)
        except Exception:
            return val
    dt_ist = to_ist(dt)
    return dt_ist.strftime("%Y-%m-%d %I:%M %p")

# ================= USER & EMPLOYEE MANAGEMENT ================= #

def get_user_by_username_or_id(db: Session, identifier: str):
    return db.query(models.User).filter(
        or_(
            models.User.username == identifier,
            models.User.employee_id == identifier
        )
    ).first()

def get_user_by_id(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_employees(db: Session, search: str = None, status: str = None):
    query = db.query(models.User).filter(models.User.role == "EMPLOYEE")
    if search:
        s = f"%{search}%"
        query = query.filter(
            or_(
                models.User.name.ilike(s),
                models.User.employee_id.ilike(s),
                models.User.phone.ilike(s),
                models.User.email.ilike(s)
            )
        )
    if status and status != "ALL":
        query = query.filter(models.User.status == status)
    return query.order_by(models.User.employee_id.asc()).all()

def create_employee(db: Session, emp: schemas.EmployeeCreate):
    # Check duplicate employee_id or username
    username = emp.username or emp.employee_id
    existing = db.query(models.User).filter(
        or_(
            models.User.employee_id == emp.employee_id,
            models.User.username == username
        )
    ).first()
    if existing:
        return None
    
    hashed = hash_password(emp.password)
    user = models.User(
        employee_id=emp.employee_id,
        name=emp.name,
        username=username,
        phone=emp.phone,
        email=emp.email,
        hashed_password=hashed,
        role=emp.role or "EMPLOYEE",
        salary_type=emp.salary_type,
        salary_rate=emp.salary_rate,
        assigned_shift_id=emp.assigned_shift_id,
        joining_date=emp.joining_date or datetime.date.today().strftime("%Y-%m-%d"),
        status=emp.status or "ACTIVE",
        created_at=datetime.datetime.utcnow()
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

def update_employee(db: Session, user_id: int, emp_update: schemas.EmployeeUpdate):
    user = get_user_by_id(db, user_id)
    if not user:
        return None
    
    update_data = emp_update.model_dump(exclude_unset=True)
    if "password" in update_data and update_data["password"]:
        user.hashed_password = hash_password(update_data["password"])
        del update_data["password"]
        
    for k, v in update_data.items():
        setattr(user, k, v)
        
    db.commit()
    db.refresh(user)
    return user

def delete_employee(db: Session, user_id: int):
    user = get_user_by_id(db, user_id)
    if user and user.role != "OWNER":
        user.status = "INACTIVE"
        db.commit()
        return True
    return False

# ================= WORK SHIFTS DEFINITIONS ================= #

def get_work_shifts(db: Session):
    return db.query(models.WorkShift).filter(models.WorkShift.is_active == True).all()

def create_work_shift(db: Session, shift_data: schemas.WorkShiftCreate):
    shift = models.WorkShift(**shift_data.model_dump())
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift

# ================= ATTENDANCE & SHIFT CHECK-IN / CHECK-OUT ================= #

def get_active_attendance_for_employee(db: Session, employee_id: int):
    return db.query(models.Attendance).filter(
        models.Attendance.employee_id == employee_id,
        models.Attendance.status == "WORKING"
    ).order_by(models.Attendance.check_in_time.desc()).first()

def employee_check_in(db: Session, user: models.User, shift_id: int = None, notes: str = None):
    # Check if already has an active working shift
    active = get_active_attendance_for_employee(db, user.id)
    if active:
        return active
    
    # Use IST for today's date and current time (India-based application)
    now_ist = datetime.datetime.now(IST_ZONE)
    today_str = now_ist.strftime("%Y-%m-%d")
    
    # Identify shift
    assigned_shift = None
    if shift_id:
        assigned_shift = db.query(models.WorkShift).filter(models.WorkShift.id == shift_id).first()
    elif user.assigned_shift_id:
        assigned_shift = db.query(models.WorkShift).filter(models.WorkShift.id == user.assigned_shift_id).first()
    
    if not assigned_shift:
        assigned_shift = db.query(models.WorkShift).filter(models.WorkShift.is_active == True).first()

    late_minutes = 0
    if assigned_shift and assigned_shift.start_time:
        try:
            shift_h, shift_m = map(int, assigned_shift.start_time.split(':'))
            # Compare current IST time with shift start time (also in IST)
            expected_time = now_ist.replace(hour=shift_h, minute=shift_m, second=0, microsecond=0)
            if now_ist > expected_time:
                diff = now_ist - expected_time
                late_minutes = int(diff.total_seconds() // 60)
        except Exception:
            late_minutes = 0

    # Store check_in_time as UTC in DB (standard practice; display layer converts to IST)
    attendance = models.Attendance(
        employee_id=user.id,
        employee_code=user.employee_id,
        employee_name=user.name,
        shift_id=assigned_shift.id if assigned_shift else None,
        shift_name=assigned_shift.name if assigned_shift else "General Shift",
        date=today_str,
        check_in_time=datetime.datetime.utcnow(),
        status="WORKING",
        late_minutes=late_minutes,
        notes=notes
    )
    db.add(attendance)
    db.commit()
    db.refresh(attendance)
    return attendance

def employee_check_out(db: Session, attendance_id: int, notes: str = None):
    att = db.query(models.Attendance).filter(models.Attendance.id == attendance_id).first()
    if not att or att.status != "WORKING":
        return None
    
    now = datetime.datetime.utcnow()
    att.check_out_time = now
    att.status = "COMPLETED"
    
    # Calculate working duration in minutes
    if att.check_in_time:
        duration = now - att.check_in_time
        att.working_minutes = int(duration.total_seconds() // 60)
        
    if notes:
        att.notes = f"{att.notes or ''} | {notes}".strip(" |")
        
    db.commit()
    db.refresh(att)
    return att

def get_attendances(db: Session, employee_id: int = None, date_filter: str = "today", custom_date: str = None):
    query = db.query(models.Attendance)
    
    if employee_id:
        query = query.filter(models.Attendance.employee_id == employee_id)
        
    today = get_today_ist()
    if date_filter == "today":
        today_str = today.strftime("%Y-%m-%d")
        query = query.filter(models.Attendance.date == today_str)
    elif date_filter == "yesterday":
        yest_str = (today - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        query = query.filter(models.Attendance.date == yest_str)
    elif date_filter == "this_week":
        start_of_week = today - datetime.timedelta(days=today.weekday())
        query = query.filter(models.Attendance.date >= start_of_week.strftime("%Y-%m-%d"))
    elif date_filter == "this_month":
        month_prefix = today.strftime("%Y-%m")
        query = query.filter(models.Attendance.date.like(f"{month_prefix}-%"))
    elif date_filter == "custom" and custom_date:
        query = query.filter(models.Attendance.date == custom_date)

    return query.order_by(models.Attendance.check_in_time.desc()).all()

def get_working_now_employees(db: Session):
    working = db.query(models.Attendance).filter(models.Attendance.status == "WORKING").all()
    results = []
    now = datetime.datetime.utcnow()
    for w in working:
        checkin_utc = w.check_in_time if w.check_in_time else now
        duration_mins = max(0, int((now - checkin_utc).total_seconds() // 60))
        hours = duration_mins // 60
        mins = duration_mins % 60
        results.append({
            "attendance_id": w.id,
            "employee_id": w.employee_id,
            "employee_code": w.employee_code,
            "employee_name": w.employee_name,
            "shift_name": w.shift_name,
            "check_in_time": format_time_12h(w.check_in_time),
            "working_duration": f"{hours}h {mins:02d}m",
            "bills_count": w.bills_count,
            "total_sales": round(w.total_sales, 2)
        })
    return results

# ================= SALARY MANAGEMENT & PAYMENTS ================= #

def calculate_monthly_salaries(db: Session, month_year: str = None):
    if not month_year:
        month_year = datetime.date.today().strftime("%Y-%m")
        
    employees = db.query(models.User).filter(
        models.User.role == "EMPLOYEE",
        models.User.status == "ACTIVE"
    ).all()

    # Total days in target month
    year, month = map(int, month_year.split('-'))
    if month == 12:
        total_month_days = 31
    else:
        next_month = datetime.date(year, month + 1, 1)
        total_month_days = (next_month - datetime.date(year, month, 1)).days

    records = []
    for emp in employees:
        # Check if record already exists
        existing = db.query(models.SalaryRecord).filter(
            models.SalaryRecord.employee_id == emp.id,
            models.SalaryRecord.month_year == month_year
        ).first()

        # Compute attendance stats
        attendances = db.query(models.Attendance).filter(
            models.Attendance.employee_id == emp.id,
            models.Attendance.date.like(f"{month_year}-%"),
            models.Attendance.status == "COMPLETED"
        ).all()

        present_days = len(attendances)
        late_days = sum(1 for a in attendances if a.late_minutes > 15)
        total_minutes = sum(a.working_minutes for a in attendances)
        total_working_hours = round(total_minutes / 60.0, 1)

        # Estimate absent days (assuming standard working month)
        estimated_absent = max(0, 26 - present_days) # Standard 26 working days

        # Calculate salary
        if emp.salary_type == "MONTHLY":
            # Standard monthly rate
            calculated_salary = emp.salary_rate
        elif emp.salary_type == "DAILY":
            calculated_salary = present_days * emp.salary_rate
        elif emp.salary_type == "HOURLY":
            calculated_salary = total_working_hours * emp.salary_rate
        else:
            calculated_salary = emp.salary_rate

        if existing:
            if existing.payment_status != "PAID":
                existing.present_days = present_days
                existing.absent_days = estimated_absent
                existing.late_days = late_days
                existing.total_working_hours = total_working_hours
                existing.calculated_salary = round(calculated_salary, 2)
            records.append(existing)
        else:
            new_rec = models.SalaryRecord(
                employee_id=emp.id,
                employee_code=emp.employee_id,
                employee_name=emp.name,
                month_year=month_year,
                salary_type=emp.salary_type,
                salary_rate=emp.salary_rate,
                present_days=present_days,
                absent_days=estimated_absent,
                late_days=late_days,
                total_working_hours=total_working_hours,
                calculated_salary=round(calculated_salary, 2),
                paid_amount=0.0,
                payment_status="PENDING"
            )
            db.add(new_rec)
            records.append(new_rec)

    db.commit()
    return db.query(models.SalaryRecord).filter(models.SalaryRecord.month_year == month_year).all()

def get_salary_records(db: Session, month_year: str = None, employee_id: int = None):
    calculate_monthly_salaries(db, month_year)
    query = db.query(models.SalaryRecord)
    if month_year:
        query = query.filter(models.SalaryRecord.month_year == month_year)
    if employee_id:
        query = query.filter(models.SalaryRecord.employee_id == employee_id)
    return query.order_by(models.SalaryRecord.employee_code.asc()).all()

def pay_salary(db: Session, salary_record_id: int, payment_method: str, payment_reference: str = None, notes: str = None):
    record = db.query(models.SalaryRecord).filter(models.SalaryRecord.id == salary_record_id).first()
    if not record:
        return None
    
    record.paid_amount = record.calculated_salary
    record.payment_status = "PAID"
    record.payment_date = datetime.datetime.utcnow()
    record.payment_method = payment_method
    record.payment_reference = payment_reference or f"SAL-{int(datetime.datetime.now().timestamp()) % 1000000}"
    record.notes = notes
    
    db.commit()
    db.refresh(record)
    return record

# ================= SALES BY EMPLOYEE LEADERBOARD ================= #

def get_sales_by_employee(db: Session, date_filter: str = "today", custom_date: str = None):
    today = datetime.date.today()
    start_date = None
    
    if date_filter == "today":
        start_date = datetime.datetime(today.year, today.month, today.day, 0, 0, 0)
    elif date_filter == "yesterday":
        yest = today - datetime.timedelta(days=1)
        start_date = datetime.datetime(yest.year, yest.month, yest.day, 0, 0, 0)
    elif date_filter == "this_week":
        start_of_week = today - datetime.timedelta(days=today.weekday())
        start_date = datetime.datetime(start_of_week.year, start_of_week.month, start_of_week.day, 0, 0, 0)
    elif date_filter == "this_month":
        start_date = datetime.datetime(today.year, today.month, 1, 0, 0, 0)
    elif date_filter == "custom" and custom_date:
        y, m, d = map(int, custom_date.split('-'))
        start_date = datetime.datetime(y, m, d, 0, 0, 0)

    query = db.query(
        models.Order.employee_id,
        models.Order.cashier_name,
        func.count(models.Order.id).label("bills_count"),
        func.sum(models.Order.grand_total).label("total_sales")
    ).filter(models.Order.status == "COMPLETED")

    if start_date:
        query = query.filter(models.Order.created_at >= start_date)

    results = query.group_by(models.Order.employee_id, models.Order.cashier_name).order_by(desc("total_sales")).all()

    return [
        {
            "employee_id": r[0] or "EMP001",
            "employee_name": r[1] or "Cashier",
            "bills_count": r[2] or 0,
            "total_sales": round(r[3] or 0.0, 2)
        }
        for r in results
    ]

# ================= PRODUCTS CRUD ================= #

def get_products(db: Session, skip: int = 0, limit: int = 500, search: str = None, category: str = None, low_stock: bool = False):
    query = db.query(models.Product).filter(models.Product.is_active == True)
    if search:
        s = f"%{search}%"
        query = query.filter(
            or_(
                models.Product.name.ilike(s),
                models.Product.barcode.ilike(s),
                models.Product.sku.ilike(s),
                models.Product.brand.ilike(s)
            )
        )
    if category and category != "All":
        query = query.filter(models.Product.category == category)
    if low_stock:
        query = query.filter(models.Product.stock_qty <= models.Product.min_stock)
    return query.order_by(models.Product.name.asc()).offset(skip).limit(limit).all()

def get_product_by_barcode(db: Session, barcode: str):
    return db.query(models.Product).filter(
        models.Product.barcode == barcode,
        models.Product.is_active == True
    ).first()

def get_product(db: Session, product_id: int):
    return db.query(models.Product).filter(models.Product.id == product_id).first()

def create_product(db: Session, prod: schemas.ProductCreate):
    db_prod = models.Product(**prod.model_dump())
    db.add(db_prod)
    db.commit()
    db.refresh(db_prod)
    if db_prod.stock_qty and db_prod.stock_qty > 0:
        record_stock_movement(
            db=db,
            product_id=db_prod.id,
            product_name=db_prod.name,
            barcode=db_prod.barcode,
            movement_type="OPENING_STOCK",
            quantity_change=db_prod.stock_qty,
            balance_after=db_prod.stock_qty,
            reference_type="OPENING_STOCK",
            reference_id=f"PROD-{db_prod.id}",
            reason="Initial Opening Stock",
            user_name="Owner"
        )
        db.commit()
    return db_prod

def update_product(db: Session, product_id: int, prod_update: schemas.ProductUpdate):
    db_prod = get_product(db, product_id)
    if not db_prod:
        return None
    old_stock = db_prod.stock_qty or 0.0
    update_data = prod_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_prod, key, value)
    db_prod.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(db_prod)
    if "stock_qty" in update_data and update_data["stock_qty"] is not None and update_data["stock_qty"] != old_stock:
        diff = db_prod.stock_qty - old_stock
        record_stock_movement(
            db=db,
            product_id=db_prod.id,
            product_name=db_prod.name,
            barcode=db_prod.barcode,
            movement_type="ADJUSTMENT",
            quantity_change=diff,
            balance_after=db_prod.stock_qty,
            reference_type="ADJUSTMENT",
            reference_id=f"PROD-{db_prod.id}",
            reason="Product stock updated",
            user_name="Owner"
        )
        db.commit()
    return db_prod

def adjust_stock(db: Session, product_id: int, qty_change: float, reason: str = "Adjustment"):
    db_prod = get_product(db, product_id)
    if not db_prod:
        return None
    db_prod.stock_qty = max(0.0, db_prod.stock_qty + qty_change)
    db.commit()
    db.refresh(db_prod)
    record_stock_movement(
        db=db,
        product_id=db_prod.id,
        product_name=db_prod.name,
        barcode=db_prod.barcode,
        movement_type="ADJUSTMENT",
        quantity_change=qty_change,
        balance_after=db_prod.stock_qty,
        reference_type="ADJUSTMENT",
        reference_id=f"PROD-{db_prod.id}",
        reason=reason,
        user_name="Owner"
    )
    db.commit()
    return db_prod

def delete_product(db: Session, product_id: int):
    db_prod = get_product(db, product_id)
    if db_prod:
        db_prod.is_active = False
        db.commit()
        return True
    return False

# ================= CUSTOMER CRUD ================= #

def get_customers(db: Session, search: str = None, limit: int = 100):
    query = db.query(models.Customer)
    if search:
        s = f"%{search}%"
        query = query.filter(
            or_(
                models.Customer.name.ilike(s),
                models.Customer.phone.ilike(s),
                models.Customer.email.ilike(s)
            )
        )
    return query.order_by(models.Customer.total_spent.desc()).limit(limit).all()

def get_customer_by_phone(db: Session, phone: str):
    return db.query(models.Customer).filter(models.Customer.phone == phone).first()

def create_customer(db: Session, cust: schemas.CustomerCreate):
    db_cust = models.Customer(**cust.model_dump())
    db.add(db_cust)
    db.commit()
    db.refresh(db_cust)
    return db_cust

# ================= CHECKOUT & ORDER CRUD ================= #

# ================= AUDIT LOG & STOCK LEDGER HELPERS ================= #

def log_audit_event(
    db: Session,
    user_id: int = None,
    username: str = None,
    employee_id: str = None,
    role: str = None,
    action: str = "ACTION",
    entity: str = None,
    entity_id: str = None,
    old_value: str = None,
    new_value: str = None,
    ip_address: str = None,
    details: str = None
):
    try:
        log = models.AuditLog(
            user_id=user_id,
            username=username or "System",
            employee_id=employee_id,
            role=role or "SYSTEM",
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id is not None else None,
            old_value=str(old_value) if old_value is not None else None,
            new_value=str(new_value) if new_value is not None else None,
            ip_address=ip_address,
            details=details,
            created_at=datetime.datetime.utcnow()
        )
        db.add(log)
    except Exception as e:
        print(f"[AUDIT LOG ERROR]: {e}")

def record_stock_movement(
    db: Session,
    product_id: int,
    product_name: str,
    barcode: str,
    movement_type: str,
    quantity_change: float,
    balance_after: float,
    reference_type: str = None,
    reference_id: str = None,
    reason: str = None,
    user_name: str = "System"
):
    try:
        movement = models.StockMovement(
            product_id=product_id,
            product_name=product_name,
            barcode=barcode or "",
            movement_type=movement_type,
            quantity_change=quantity_change,
            balance_after=balance_after,
            reference_type=reference_type,
            reference_id=reference_id,
            reason=reason,
            user_name=user_name,
            created_at=datetime.datetime.utcnow()
        )
        db.add(movement)
    except Exception as e:
        print(f"[STOCK MOVEMENT ERROR]: {e}")

# ================= CHECKOUT & ORDER CRUD ================= #

def generate_invoice_number(db: Session):
    today_str = datetime.datetime.now().strftime("%Y%m%d")
    count_today = db.query(models.Order).filter(
        models.Order.invoice_number.like(f"INV-{today_str}-%")
    ).count()
    return f"INV-{today_str}-{(count_today + 1):04d}"

def process_checkout(db: Session, req: schemas.CheckoutRequest):
    invoice_no = generate_invoice_number(db)
    
    # Check customer
    customer = None
    if req.customer_id:
        customer = db.query(models.Customer).filter(models.Customer.id == req.customer_id).first()
    elif req.customer_phone:
        customer = get_customer_by_phone(db, req.customer_phone)
        if not customer and req.customer_name:
            customer = models.Customer(
                name=req.customer_name,
                phone=req.customer_phone
            )
            db.add(customer)
            db.flush()

    payment_details_str = json.dumps(req.payment_details or {})

    # Calculate item totals if not fully provided
    computed_subtotal = 0.0
    computed_tax = 0.0
    
    # Pre-fetch products for price & barcode fallbacks
    for item in req.items:
        prod = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        if not item.barcode and prod:
            item.barcode = prod.barcode
        u_price = item.unit_price if (item.unit_price is not None and item.unit_price > 0) else (item.price if (item.price is not None and item.price > 0) else (prod.selling_price if prod else 0.0))
        item.unit_price = u_price
        t_rate = item.tax_rate if item.tax_rate is not None else (item.tax_percent if item.tax_percent is not None else (prod.tax_rate if prod else 0.0))
        item.tax_rate = t_rate
        line_sub = round(u_price * item.quantity, 2)
        computed_subtotal += line_sub
        computed_tax += round(line_sub * (t_rate / 100.0), 2)

    subtotal_val = req.subtotal if req.subtotal is not None else round(computed_subtotal, 2)
    tax_val = req.tax_amount or req.tax_total or round(computed_tax, 2)
    disc_val = req.discount_amount or req.discount_total or 0.0
    pts_disc = req.points_discount or 0.0
    rnd_off = req.round_off or 0.0
    
    grand_total_val = req.grand_total if req.grand_total is not None else round(max(0.0, subtotal_val + tax_val - disc_val - pts_disc + rnd_off), 2)
    pay_method = req.payment_method or req.payment_mode or "CASH"

    # Tendered and change calculation
    tendered_amt = float(getattr(req, "tendered_amount", None) or getattr(req, "amount_paid", None) or grand_total_val)
    change_amt = max(0.0, round(tendered_amt - grand_total_val, 2)) if pay_method == "CASH" else 0.0

    # Create Order
    order = models.Order(
        invoice_number=invoice_no,
        customer_id=customer.id if customer else None,
        customer_name=req.customer_name or (customer.name if customer else "Walk-in Customer"),
        customer_phone=req.customer_phone or (customer.phone if customer else None),
        employee_id=req.employee_id or "EMP001",
        cashier_name=req.cashier_name or "Ravi Kumar",
        register_number=req.register_number or "REG-01",
        counter_id=getattr(req, "counter_id", "Counter 1") or "Counter 1",
        shift_id=req.shift_id,
        attendance_id=req.attendance_id,
        subtotal=subtotal_val,
        tax_amount=tax_val,
        discount_amount=disc_val,
        coupon_code=req.coupon_code,
        points_redeemed=req.points_redeemed or 0,
        points_discount=pts_disc,
        round_off=rnd_off,
        grand_total=grand_total_val,
        payment_method=pay_method,
        tendered_amount=tendered_amt,
        change_amount=change_amt,
        payment_details=payment_details_str,
        status="COMPLETED",
        created_at=datetime.datetime.utcnow()
    )
    db.add(order)
    db.flush()

    total_items_count = 0
    # Process items, deduct stock and record stock movements
    for item in req.items:
        prod = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        if prod:
            prod.stock_qty = max(0.0, prod.stock_qty - item.quantity)
            prod_cost = prod.cost_price
            
            # Record stock movement in ledger
            record_stock_movement(
                db=db,
                product_id=prod.id,
                product_name=prod.name,
                barcode=prod.barcode,
                movement_type="SALE",
                quantity_change=-float(item.quantity),
                balance_after=float(prod.stock_qty),
                reference_type="ORDER",
                reference_id=order.invoice_number,
                reason=f"POS Sale to {order.customer_name}",
                user_name=order.cashier_name
            )

            # Deduct batch quantity if product has batches (FEFO: First Expiry First Out)
            try:
                batches = db.query(models.ProductBatch).filter(
                    models.ProductBatch.product_id == prod.id,
                    models.ProductBatch.status == "ACTIVE",
                    models.ProductBatch.quantity > 0
                ).order_by(models.ProductBatch.expiry_date.asc()).all()
                
                remaining_qty_to_deduct = float(item.quantity)
                for b in batches:
                    if remaining_qty_to_deduct <= 0:
                        break
                    deduct = min(b.quantity, remaining_qty_to_deduct)
                    b.quantity -= deduct
                    remaining_qty_to_deduct -= deduct
                    if b.quantity <= 0:
                        b.status = "EXHAUSTED"
            except Exception as batch_err:
                print(f"[BATCH DEDUCT ERROR]: {batch_err}")
        else:
            prod_cost = item.cost_price or 0.0

        item_pname = item.product_name or item.name or (prod.name if prod else "Supermarket Item")
        item_tax_rate = item.tax_rate if item.tax_rate is not None else (item.tax_percent if item.tax_percent is not None else (prod.tax_rate if prod else 0.0))
        item_u_price = item.unit_price or (prod.selling_price if prod else 0.0)
        tax_amt = (item_u_price * item.quantity) * (item_tax_rate / 100.0)
        item_total = item.total_price if (item.total_price and item.total_price > 0) else ((item_u_price * item.quantity) + tax_amt - (item.discount_amount or 0.0))
        total_items_count += int(item.quantity)

        order_item = models.OrderItem(
            order_id=order.id,
            product_id=item.product_id,
            product_name=item_pname,
            barcode=item.barcode or (prod.barcode if prod else ""),
            quantity=item.quantity,
            unit=item.unit,
            unit_price=item_u_price,
            cost_price=prod_cost,
            tax_rate=item_tax_rate,
            tax_amount=round(tax_amt, 2),
            discount_amount=item.discount_amount or 0.0,
            total_price=round(item_total, 2)
        )
        db.add(order_item)

    # If coupon was used, increment promo usage
    if req.coupon_code:
        promo = db.query(models.Promotion).filter(models.Promotion.code == req.coupon_code.strip().upper()).first()
        if promo:
            promo.used_count = (promo.used_count or 0) + 1

    # Update active attendance shift summary if linked
    if req.attendance_id:
        att = db.query(models.Attendance).filter(models.Attendance.id == req.attendance_id).first()
        if att:
            att.bills_count = (att.bills_count or 0) + 1
            att.total_sales = (att.total_sales or 0.0) + grand_total_val
            att.items_sold = (att.items_sold or 0) + total_items_count
            if pay_method == "CASH":
                att.cash_sales = (att.cash_sales or 0.0) + grand_total_val
            elif pay_method == "UPI":
                att.upi_sales = (att.upi_sales or 0.0) + grand_total_val
            elif pay_method == "CARD":
                att.card_sales = (att.card_sales or 0.0) + grand_total_val
            elif pay_method == "SPLIT" and req.payment_details:
                att.cash_sales = (att.cash_sales or 0.0) + float(req.payment_details.get("cash_amount", 0))
                att.upi_sales = (att.upi_sales or 0.0) + float(req.payment_details.get("upi_amount", 0))
                att.card_sales = (att.card_sales or 0.0) + float(req.payment_details.get("card_amount", 0))
    elif req.employee_id:
        # Link to employee's currently active working attendance if any
        user = db.query(models.User).filter(models.User.employee_id == req.employee_id).first()
        if user:
            att = get_active_attendance_for_employee(db, user.id)
            if att:
                order.attendance_id = att.id
                att.bills_count = (att.bills_count or 0) + 1
                att.total_sales = (att.total_sales or 0.0) + grand_total_val
                att.items_sold = (att.items_sold or 0) + total_items_count
                if pay_method == "CASH":
                    att.cash_sales = (att.cash_sales or 0.0) + grand_total_val
                elif pay_method == "UPI":
                    att.upi_sales = (att.upi_sales or 0.0) + grand_total_val
                elif pay_method == "CARD":
                    att.card_sales = (att.card_sales or 0.0) + grand_total_val

    # Update Customer loyalty points (Configurable conversion)
    if customer:
        customer.total_spent = (customer.total_spent or 0.0) + grand_total_val
        customer.visits_count = (customer.visits_count or 0) + 1
        curr_pts = customer.loyalty_points or 0
        if req.points_redeemed and req.points_redeemed > 0:
            curr_pts = max(0, curr_pts - req.points_redeemed)
        earned_points = int(grand_total_val // 100) # 1 point per Rs 100 spent
        customer.loyalty_points = curr_pts + earned_points
        if customer.total_spent > 50000:
            customer.tier = "Platinum"
        elif customer.total_spent > 20000:
            customer.tier = "Gold"
        elif customer.total_spent > 5000:
            customer.tier = "Silver"

    # Audit Logging
    log_audit_event(
        db=db,
        username=order.cashier_name,
        employee_id=order.employee_id,
        role="EMPLOYEE",
        action="CHECKOUT",
        entity="ORDER",
        entity_id=order.invoice_number,
        new_value=f"Grand Total: Rs {order.grand_total}, Items: {total_items_count}, Method: {pay_method}",
        details=f"Customer: {order.customer_name}, Register: {order.register_number}"
    )

    db.commit()
    db.refresh(order)
    return order

# ================= HOLD / SUSPEND BILLS ================= #

def hold_cart(db: Session, req: schemas.HoldCartRequest):
    ref_no = f"HOLD-{int(datetime.datetime.now().timestamp()) % 100000:05d}"
    db_hold = models.HoldCart(
        cart_ref=ref_no,
        customer_name=req.customer_name or "Walk-in Customer",
        customer_phone=req.customer_phone,
        items_json=json.dumps(req.items),
        notes=req.notes,
        created_at=datetime.datetime.utcnow()
    )
    db.add(db_hold)
    db.commit()
    db.refresh(db_hold)
    return db_hold

def get_held_carts(db: Session):
    return db.query(models.HoldCart).order_by(models.HoldCart.created_at.desc()).all()

def recall_held_cart(db: Session, cart_id: int):
    cart = db.query(models.HoldCart).filter(models.HoldCart.id == cart_id).first()
    if cart:
        items = json.loads(cart.items_json)
        db.delete(cart)
        db.commit()
        return {
            "cart_ref": cart.cart_ref,
            "customer_name": cart.customer_name,
            "customer_phone": cart.customer_phone,
            "notes": cart.notes,
            "items": items
        }
    return None

def delete_held_cart(db: Session, cart_id: int):
    cart = db.query(models.HoldCart).filter(models.HoldCart.id == cart_id).first()
    if cart:
        db.delete(cart)
        db.commit()
        return True
    return False

# ================= SHIFTS & CASH DRAWER ================= #

def get_active_shift(db: Session, cashier_name: str = None):
    query = db.query(models.Shift).filter(models.Shift.status == "OPEN")
    if cashier_name:
        query = query.filter(models.Shift.cashier_name == cashier_name)
    return query.order_by(models.Shift.opened_at.desc()).first()

def open_shift(db: Session, req: schemas.ShiftOpenRequest):
    existing = db.query(models.Shift).filter(
        models.Shift.register_number == req.register_number,
        models.Shift.status == "OPEN"
    ).first()
    if existing:
        return existing
    
    new_shift = models.Shift(
        cashier_name=req.cashier_name,
        register_number=req.register_number or "REG-01",
        opening_cash=req.opening_cash,
        expected_cash=req.opening_cash,
        opened_at=datetime.datetime.utcnow(),
        status="OPEN"
    )
    db.add(new_shift)
    db.commit()
    db.refresh(new_shift)
    return new_shift

def add_cash_movement(db: Session, req: schemas.CashMovementRequest):
    shift = db.query(models.Shift).filter(models.Shift.id == req.shift_id).first()
    if not shift or shift.status != "OPEN":
        return None
    
    movement = models.CashMovement(
        shift_id=req.shift_id,
        movement_type=req.movement_type,
        amount=req.amount,
        reason=req.reason,
        created_at=datetime.datetime.utcnow()
    )
    db.add(movement)
    
    if req.movement_type == "CASH_IN":
        shift.expected_cash += req.amount
    elif req.movement_type == "CASH_OUT":
        shift.expected_cash -= req.amount
        
    db.commit()
    db.refresh(movement)
    return movement

def close_shift(db: Session, shift_id: int, req: schemas.ShiftCloseRequest):
    shift = db.query(models.Shift).filter(models.Shift.id == shift_id).first()
    if not shift or shift.status != "OPEN":
        return None
    
    shift.closed_at = datetime.datetime.utcnow()
    shift.closing_cash = req.actual_cash
    shift.actual_cash = req.actual_cash
    shift.cash_difference = round(req.actual_cash - shift.expected_cash, 2)
    shift.notes = req.notes
    shift.status = "CLOSED"
    
    db.commit()
    db.refresh(shift)
    return shift

# ================= SUPPLIERS & PURCHASES ================= #

def _supplier_to_dict(s: models.Supplier) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "contact_person": s.contact_person,
        "phone": s.phone,
        "email": s.email,
        "address": s.address,
        "gstin": s.gstin,
        "is_active": s.is_active,
        "company_name": getattr(s, "company_name", None),
        "city": getattr(s, "city", None),
        "state": getattr(s, "state", None),
        "payment_terms": getattr(s, "payment_terms", None),
        "bank_details": getattr(s, "bank_details", None),
        "notes": getattr(s, "notes", None),
        "status": getattr(s, "status", "ACTIVE"),
        "created_at": s.created_at.isoformat() if getattr(s, "created_at", None) else None,
    }

def get_suppliers(db: Session):
    suppliers = db.query(models.Supplier).filter(models.Supplier.is_active == True).all()
    return [_supplier_to_dict(s) for s in suppliers]

def get_supplier(db: Session, supplier_id: int):
    return db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()

def create_supplier(db: Session, supp: schemas.SupplierCreate):
    data = supp.model_dump()
    db_supp = models.Supplier(**data)
    db.add(db_supp)
    db.commit()
    db.refresh(db_supp)
    return _supplier_to_dict(db_supp)

def update_supplier(db: Session, supplier_id: int, supp_update: schemas.SupplierUpdate):
    db_supp = get_supplier(db, supplier_id)
    if not db_supp:
        return None
    update_data = supp_update.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(db_supp, k, v)
    db.commit()
    db.refresh(db_supp)
    return _supplier_to_dict(db_supp)

def delete_supplier(db: Session, supplier_id: int):
    db_supp = get_supplier(db, supplier_id)
    if not db_supp:
        return False
    db_supp.is_active = False
    db.commit()
    return True

def create_purchase_order(db: Session, po_req: schemas.PurchaseOrderCreate):
    po_no = f"PO-{datetime.datetime.now().strftime('%Y%m')}-{(db.query(models.PurchaseOrder).count() + 1):04d}"
    
    calculated_total = 0.0
    for it in po_req.items:
        q = float(it.get("quantity") or it.get("ordered_quantity") or it.get("qty") or 0.0)
        p = float(it.get("purchase_price") or it.get("cost_price") or it.get("unit_price") or 0.0)
        t = float(it.get("gst_rate") or it.get("tax_percent") or it.get("tax_rate") or 0.0)
        line = (q * p) * (1.0 + t / 100.0)
        calculated_total += line

    total_amount = float(po_req.total_amount) if (po_req.total_amount is not None and po_req.total_amount > 0) else round(calculated_total, 2)
    paid_amount = float(po_req.paid_amount or 0.0)
    due_amount = max(0.0, round(total_amount - paid_amount, 2))
    
    if paid_amount <= 0:
        payment_status = "PENDING"
    elif paid_amount >= total_amount:
        payment_status = "PAID"
    else:
        payment_status = "PARTIAL"
        
    po = models.PurchaseOrder(
        po_number=po_no,
        supplier_id=po_req.supplier_id,
        invoice_number=po_req.invoice_number,
        supplier_invoice_number=po_req.supplier_invoice_number or po_req.invoice_number,
        purchase_date=po_req.purchase_date or datetime.date.today().strftime("%Y-%m-%d"),
        total_amount=total_amount,
        tax_amount=po_req.tax_amount or 0.0,
        discount_amount=po_req.discount_amount or 0.0,
        subtotal_amount=total_amount,
        paid_amount=paid_amount,
        due_amount=due_amount,
        payment_status=payment_status,
        status="PENDING",
        received_status="PENDING",
        items_json=json.dumps(po_req.items),
        notes=po_req.notes,
        created_at=datetime.datetime.utcnow()
    )
    db.add(po)
    db.commit()
    db.refresh(po)
    return get_purchase_order_detail(db, po.id)

def get_purchase_orders(db: Session, limit: int = 50):
    return db.query(models.PurchaseOrder).order_by(models.PurchaseOrder.created_at.desc()).limit(limit).all()

def get_purchase_order_detail(db: Session, po_id: int):
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        return None
    items = json.loads(po.items_json or "[]")
    return {
        "id": po.id,
        "po_number": po.po_number,
        "supplier_id": po.supplier_id,
        "supplier_name": po.supplier.name if po.supplier else "N/A",
        "invoice_number": po.invoice_number,
        "supplier_invoice_number": getattr(po, "supplier_invoice_number", None),
        "purchase_date": getattr(po, "purchase_date", None),
        "total_amount": po.total_amount,
        "tax_amount": po.tax_amount,
        "discount_amount": getattr(po, "discount_amount", 0.0),
        "subtotal_amount": getattr(po, "subtotal_amount", po.total_amount),
        "paid_amount": getattr(po, "paid_amount", 0.0),
        "due_amount": getattr(po, "due_amount", 0.0),
        "payment_status": getattr(po, "payment_status", "PENDING"),
        "received_status": getattr(po, "received_status", "PENDING"),
        "status": po.status,
        "notes": po.notes,
        "created_at": po.created_at.strftime("%Y-%m-%d %H:%M") if po.created_at else None,
        "items": items,
        "items_count": len(items),
    }

def receive_purchase_order(db: Session, po_id: int, items: list, notes: str = None, paid_amount: float = 0.0, payment_mode: str = "CASH", payment_notes: str = None):
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        return None
    po_items = json.loads(po.items_json or "[]")
    
    for item in items:
        product_id = item.get("product_id")
        item_id = item.get("item_id")
        received_qty = float(item.get("received_qty") or item.get("received_quantity") or item.get("quantity") or 0.0)
        
        if not product_id and item_id is not None:
            for p_it in po_items:
                if str(p_it.get("id")) == str(item_id) or str(p_it.get("product_id")) == str(item_id):
                    product_id = p_it.get("product_id")
                    break
            if not product_id:
                try:
                    product_id = int(item_id)
                except (ValueError, TypeError):
                    pass
        
        if product_id and received_qty > 0:
            prod = db.query(models.Product).filter(models.Product.id == product_id).first()
            if prod:
                prod.stock_qty += received_qty

    if paid_amount and paid_amount > 0:
        po.paid_amount = (po.paid_amount or 0.0) + paid_amount
        po.due_amount = max(0.0, round(po.total_amount - po.paid_amount, 2))
        if po.paid_amount >= po.total_amount:
            po.payment_status = "PAID"
        elif po.paid_amount > 0:
            po.payment_status = "PARTIAL"
        
        pay_rec = models.SupplierPayment(
            supplier_id=po.supplier_id,
            purchase_order_id=po.id,
            amount=paid_amount,
            payment_date=datetime.date.today().strftime("%Y-%m-%d"),
            payment_method=payment_mode or "CASH",
            reference_number=f"GRN-PAY-{po.po_number}",
            notes=payment_notes or "Paid during Goods Receiving (GRN)"
        )
        db.add(pay_rec)

    po.received_status = "RECEIVED"
    po.status = "RECEIVED"
    if notes:
        po.notes = f"{po.notes or ''} | {notes}".strip(" |")
    db.commit()
    db.refresh(po)
    return get_purchase_order_detail(db, po_id)

def create_supplier_payment(db: Session, req: schemas.SupplierPaymentCreate):
    payment = models.SupplierPayment(
        supplier_id=req.supplier_id,
        purchase_order_id=req.purchase_order_id,
        amount=req.amount,
        payment_date=req.payment_date,
        payment_method=req.payment_method or "CASH",
        reference_number=req.reference_number,
        notes=req.notes,
        created_at=datetime.datetime.utcnow()
    )
    db.add(payment)
    # Update linked PO if provided
    if req.purchase_order_id:
        po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == req.purchase_order_id).first()
        if po:
            new_paid = float(getattr(po, "paid_amount", 0.0)) + float(req.amount)
            po.paid_amount = new_paid
            po.due_amount = max(0.0, float(po.total_amount) - new_paid)
            if po.due_amount <= 0:
                po.payment_status = "PAID"
            elif new_paid > 0:
                po.payment_status = "PARTIAL"
    db.commit()
    db.refresh(payment)
    return {
        "id": payment.id,
        "supplier_id": payment.supplier_id,
        "purchase_order_id": payment.purchase_order_id,
        "amount": payment.amount,
        "payment_date": payment.payment_date,
        "payment_method": payment.payment_method,
        "reference_number": payment.reference_number,
        "notes": payment.notes,
        "created_at": payment.created_at.isoformat() if payment.created_at else None,
    }

def get_supplier_payments(db: Session, supplier_id: int):
    payments = db.query(models.SupplierPayment).filter(
        models.SupplierPayment.supplier_id == supplier_id
    ).order_by(models.SupplierPayment.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "supplier_id": p.supplier_id,
            "purchase_order_id": p.purchase_order_id,
            "amount": p.amount,
            "payment_date": p.payment_date,
            "payment_method": p.payment_method,
            "reference_number": p.reference_number,
            "notes": p.notes,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in payments
    ]

def get_all_supplier_payments(db: Session):
    payments = db.query(models.SupplierPayment).order_by(models.SupplierPayment.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "supplier_id": p.supplier_id,
            "purchase_order_id": p.purchase_order_id,
            "amount": p.amount,
            "payment_date": p.payment_date,
            "payment_method": p.payment_method,
            "reference_number": p.reference_number,
            "notes": p.notes,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in payments
    ]

def get_supplier_purchases(db: Session, supplier_id: int):
    pos = db.query(models.PurchaseOrder).filter(
        models.PurchaseOrder.supplier_id == supplier_id
    ).order_by(models.PurchaseOrder.created_at.desc()).all()
    return [
        {
            "id": po.id,
            "po_number": po.po_number,
            "invoice_number": po.invoice_number,
            "total_amount": po.total_amount,
            "paid_amount": getattr(po, "paid_amount", 0.0),
            "due_amount": getattr(po, "due_amount", 0.0),
            "payment_status": getattr(po, "payment_status", "PENDING"),
            "received_status": getattr(po, "received_status", "PENDING"),
            "status": po.status,
            "purchase_date": getattr(po, "purchase_date", None),
            "created_at": po.created_at.strftime("%Y-%m-%d %H:%M") if po.created_at else None,
            "items_count": len(json.loads(po.items_json or "[]")),
        }
        for po in pos
    ]

def get_supplier_summary(db: Session, supplier_id: int):
    pos = db.query(models.PurchaseOrder).filter(
        models.PurchaseOrder.supplier_id == supplier_id
    ).all()
    total_purchases = sum(po.total_amount for po in pos)
    total_paid_pos = sum(float(getattr(po, "paid_amount", 0.0)) for po in pos)
    # Also include direct supplier payments
    payments = db.query(models.SupplierPayment).filter(
        models.SupplierPayment.supplier_id == supplier_id
    ).all()
    total_direct_payments = sum(p.amount for p in payments)
    total_paid = max(total_paid_pos, total_direct_payments)
    total_due = max(0.0, total_purchases - total_paid)
    return {
        "supplier_id": supplier_id,
        "total_purchases": round(total_purchases, 2),
        "total_paid": round(total_paid, 2),
        "total_due": round(total_due, 2),
        "purchase_count": len(pos),
        "payment_count": len(payments),
    }

def generate_barcode(db: Session):
    """Generate unique EAN-13 style barcode: 8901XXXXXXXXXX"""
    import random
    while True:
        suffix = random.randint(100000000, 999999999)
        barcode = f"8901{suffix}"
        existing = db.query(models.Product).filter(models.Product.barcode == barcode).first()
        if not existing:
            return barcode


# ================= OWNER DASHBOARD & METRICS ================= #

def get_owner_dashboard_summary(db: Session):
    today = get_today_ist()
    start_of_today_ist = datetime.datetime(today.year, today.month, today.day, 0, 0, 0, tzinfo=IST_ZONE)
    start_of_today = start_of_today_ist.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    
    today_orders = db.query(models.Order).filter(
        models.Order.created_at >= start_of_today,
        models.Order.status == "COMPLETED"
    ).all()
    today_sales = sum(o.grand_total for o in today_orders)
    today_orders_count = len(today_orders)
    
    # Active Employees working now
    working_now = get_working_now_employees(db)
    employees_working_now_count = len(working_now)
    total_employees_count = db.query(models.User).filter(
        models.User.role == "EMPLOYEE",
        models.User.status == "ACTIVE"
    ).count()

    # Product stock statistics
    total_products = db.query(models.Product).filter(models.Product.is_active == True).count()
    low_stock_count = db.query(models.Product).filter(
        models.Product.is_active == True,
        models.Product.stock_qty > 0,
        models.Product.stock_qty <= models.Product.min_stock
    ).count()
    out_of_stock_count = db.query(models.Product).filter(
        models.Product.is_active == True,
        models.Product.stock_qty <= 0
    ).count()

    # Pending Salaries count for current month
    month_str = today.strftime("%Y-%m")
    calculate_monthly_salaries(db, month_str)
    pending_salaries_count = db.query(models.SalaryRecord).filter(
        models.SalaryRecord.month_year == month_str,
        models.SalaryRecord.payment_status == "PENDING"
    ).count()

    # Payment Breakdown
    payment_stats = {"CASH": 0.0, "UPI": 0.0, "CARD": 0.0}
    for o in today_orders:
        method = (o.payment_method or "CASH").upper()
        if method == "SPLIT" and o.payment_details:
            try:
                details = json.loads(o.payment_details)
                payment_stats["CASH"] += float(details.get("cash_amount", 0))
                payment_stats["UPI"] += float(details.get("upi_amount", 0))
                payment_stats["CARD"] += float(details.get("card_amount", 0))
            except Exception:
                payment_stats["CASH"] += o.grand_total
        elif method in payment_stats:
            payment_stats[method] += o.grand_total
        else:
            payment_stats["CASH"] += o.grand_total

    today_profit_val = round(
        sum(
            sum((i.unit_price - i.cost_price) * i.quantity for i in o.items)
            for o in today_orders
        ), 2
    )

    return {
        "today_sales": round(today_sales, 2),
        "today_bills": today_orders_count,
        "employees_working_now": employees_working_now_count,
        "total_employees": total_employees_count,
        "total_products": total_products,
        "low_stock_products": low_stock_count,
        "low_stock_count": low_stock_count,
        "out_of_stock_products": out_of_stock_count,
        "pending_salaries": pending_salaries_count,
        "payment_stats": {k: round(v, 2) for k, v in payment_stats.items()},
        "working_now_list": working_now,
        # Enhanced fields
        "total_suppliers": db.query(models.Supplier).filter(models.Supplier.is_active == True).count(),
        "today_purchases": db.query(models.PurchaseOrder).filter(
            models.PurchaseOrder.created_at >= start_of_today
        ).count(),
        "supplier_outstanding": round(
            sum(
                float(getattr(po, "due_amount", 0.0))
                for po in db.query(models.PurchaseOrder).all()
            ), 2
        ),
        "today_profit": today_profit_val,
        "estimated_profit": today_profit_val,
        "active_workers": working_now,
        "sales_by_employee": get_sales_by_employee(db, date_filter="today"),
        "payments": {k: round(v, 2) for k, v in payment_stats.items()},
        "hourly_sales": get_hourly_sales(db),
    }

def get_employee_dashboard_summary(db: Session, employee_id: int):
    user = get_user_by_id(db, employee_id)
    if not user:
        return {}
    
    today = get_today_ist()
    start_of_today_ist = datetime.datetime(today.year, today.month, today.day, 0, 0, 0, tzinfo=IST_ZONE)
    start_of_today = start_of_today_ist.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    
    # Check-in status
    active_att = get_active_attendance_for_employee(db, user.id)
    
    # Today's completed attendance
    today_str = today.strftime("%Y-%m-%d")
    today_att = db.query(models.Attendance).filter(
        models.Attendance.employee_id == user.id,
        models.Attendance.date == today_str
    ).order_by(models.Attendance.check_in_time.desc()).first()

    # Employee bills today
    emp_orders = db.query(models.Order).filter(
        models.Order.created_at >= start_of_today,
        models.Order.employee_id == user.employee_id,
        models.Order.status == "COMPLETED"
    ).all()

    today_sales = sum(o.grand_total for o in emp_orders)
    today_bills = len(emp_orders)

    shift_info = None
    if user.assigned_shift:
        shift_info = {
            "name": user.assigned_shift.name,
            "start_time": user.assigned_shift.start_time,
            "end_time": user.assigned_shift.end_time,
            "formatted_start_time": format_time_12h(user.assigned_shift.start_time),
            "formatted_end_time": format_time_12h(user.assigned_shift.end_time),
            "formatted_range": f"{format_time_12h(user.assigned_shift.start_time)} - {format_time_12h(user.assigned_shift.end_time)}"
        }

    status_str = "NOT_CHECKED_IN"
    checked_in_time_str = None
    working_duration_str = None
    
    if active_att:
        status_str = "WORKING"
        checked_in_time_str = format_time_12h(active_att.check_in_time)
        duration_mins = int((datetime.datetime.utcnow() - active_att.check_in_time).total_seconds() // 60)
        working_duration_str = f"{duration_mins // 60}h {duration_mins % 60:02d}m"
    elif today_att and today_att.status == "COMPLETED":
        status_str = "COMPLETED"
        checked_in_time_str = format_time_12h(today_att.check_in_time) if today_att.check_in_time else None
        working_duration_str = f"{today_att.working_minutes // 60}h {today_att.working_minutes % 60:02d}m"

    recent_orders = db.query(models.Order).filter(
        models.Order.employee_id == user.employee_id
    ).order_by(models.Order.created_at.desc()).limit(10).all()

    recent_bills = [
        {
            "id": o.id,
            "invoice_number": o.invoice_number,
            "customer_name": o.customer_name or "Walk-in Customer",
            "grand_total": o.grand_total,
            "payment_method": o.payment_method,
            "items_count": len(o.items),
            "created_at": format_time_12h(o.created_at) if o.created_at else "—"
        }
        for o in recent_orders
    ]

    return {
        "employee_id": user.employee_id,
        "name": user.name,
        "assigned_shift": shift_info,
        "status": status_str,
        "checked_in_time": checked_in_time_str,
        "working_duration": working_duration_str,
        "attendance_id": active_att.id if active_att else (today_att.id if today_att else None),
        "today_bills": today_bills,
        "today_sales": round(today_sales, 2),
        "recent_bills": recent_bills
    }

def get_hourly_sales(db: Session):
    today = get_today_ist()
    start_of_today_ist = datetime.datetime(today.year, today.month, today.day, 0, 0, 0, tzinfo=IST_ZONE)
    start_of_today = start_of_today_ist.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    orders = db.query(models.Order).filter(models.Order.created_at >= start_of_today, models.Order.status == "COMPLETED").all()
    
    hours = [f"{h:02d}:00" for h in range(8, 23)]
    hourly_map = {h: 0.0 for h in hours}
    
    for o in orders:
        if o.created_at:
            dt_ist = to_ist(o.created_at)
            h_str = f"{dt_ist.hour:02d}:00"
            if h_str in hourly_map:
                hourly_map[h_str] += o.grand_total
            
    return {
        "labels": list(hourly_map.keys()),
        "values": [round(v, 2) for v in hourly_map.values()]
    }

def get_category_sales(db: Session):
    results = db.query(
        models.Product.category,
        func.sum(models.OrderItem.total_price).label("revenue"),
        func.sum(models.OrderItem.quantity).label("units")
    ).join(models.OrderItem, models.Product.id == models.OrderItem.product_id)\
     .group_by(models.Product.category).order_by(desc("revenue")).limit(8).all()
     
    return [
        {"category": r[0], "revenue": round(r[1] or 0.0, 2), "units": round(r[2] or 0.0, 1)}
        for r in results
    ]

def get_top_selling_products(db: Session, limit: int = 10):
    results = db.query(
        models.OrderItem.product_name,
        models.OrderItem.barcode,
        func.sum(models.OrderItem.quantity).label("total_qty"),
        func.sum(models.OrderItem.total_price).label("total_sales")
    ).group_by(models.OrderItem.product_id, models.OrderItem.product_name, models.OrderItem.barcode)\
     .order_by(desc("total_qty")).limit(limit).all()
     
    return [
        {
            "name": r[0],
            "barcode": r[1],
            "qty_sold": round(r[2] or 0.0, 1),
            "revenue": round(r[3] or 0.0, 2)
        }
        for r in results
    ]

# ================= SALES RETURNS ================= #

def generate_sales_return_number(db: Session):
    today_str = datetime.datetime.now().strftime("%Y%m")
    count = db.query(models.SalesReturn).count()
    return f"RET-{today_str}-{(count + 1):04d}"

def create_sales_return(db: Session, req: schemas.SalesReturnCreate, user_info: dict = None):
    user_name = user_info.get("name", "Cashier") if user_info else "Cashier"
    employee_id = user_info.get("employee_id", "EMP001") if user_info else "EMP001"
    
    # Find original order
    order = db.query(models.Order).filter(models.Order.invoice_number == req.invoice_number).first()
    ret_num = generate_sales_return_number(db)
    
    total_refund = 0.0
    return_items_to_add = []
    
    for it in req.items:
        prod = db.query(models.Product).filter(models.Product.id == it.product_id).first()
        if not prod:
            continue
        
        unit_p = it.unit_price if (it.unit_price is not None and it.unit_price > 0) else prod.selling_price
        line_refund = round(unit_p * it.returned_quantity, 2)
        total_refund += line_refund
        
        condition = it.restock_condition or "GOOD"
        
        # If restock condition is GOOD, add quantity back to inventory stock
        if condition == "GOOD":
            prod.stock_qty += it.returned_quantity
            record_stock_movement(
                db=db,
                product_id=prod.id,
                product_name=prod.name,
                barcode=prod.barcode,
                movement_type="SALES_RETURN",
                quantity_change=float(it.returned_quantity),
                balance_after=float(prod.stock_qty),
                reference_type="SALES_RETURN",
                reference_id=ret_num,
                reason=f"Return on Bill {req.invoice_number} ({req.reason})",
                user_name=user_name
            )
        else:
            # Damaged return: record damaged movement
            record_stock_movement(
                db=db,
                product_id=prod.id,
                product_name=prod.name,
                barcode=prod.barcode,
                movement_type="DAMAGE",
                quantity_change=0.0,
                balance_after=float(prod.stock_qty),
                reference_type="SALES_RETURN",
                reference_id=ret_num,
                reason=f"Damaged Return on Bill {req.invoice_number} ({req.reason})",
                user_name=user_name
            )

        return_items_to_add.append({
            "product_id": prod.id,
            "product_name": prod.name,
            "barcode": prod.barcode,
            "returned_quantity": it.returned_quantity,
            "unit": prod.unit,
            "unit_price": unit_p,
            "refund_amount": line_refund,
            "restock_condition": condition
        })

    ret_record = models.SalesReturn(
        return_number=ret_num,
        order_id=order.id if order else None,
        invoice_number=req.invoice_number,
        customer_name=order.customer_name if order else "Walk-in Customer",
        customer_phone=order.customer_phone if order else None,
        employee_id=employee_id,
        cashier_name=user_name,
        total_refund=round(total_refund, 2),
        refund_method=req.refund_method or "CASH",
        reason=req.reason,
        notes=req.notes,
        created_at=datetime.datetime.utcnow()
    )
    db.add(ret_record)
    db.flush()

    for item_data in return_items_to_add:
        item_obj = models.SalesReturnItem(
            sales_return_id=ret_record.id,
            **item_data
        )
        db.add(item_obj)

    log_audit_event(
        db=db,
        username=user_name,
        employee_id=employee_id,
        role="EMPLOYEE",
        action="SALES_RETURN",
        entity="RETURN",
        entity_id=ret_num,
        new_value=f"Refund: Rs {total_refund}, Original Bill: {req.invoice_number}",
        details=f"Reason: {req.reason}, Items: {len(return_items_to_add)}"
    )

    db.commit()
    db.refresh(ret_record)
    return get_sales_return_detail(db, ret_record.id)

def get_sales_returns(db: Session, limit: int = 100):
    returns = db.query(models.SalesReturn).order_by(models.SalesReturn.created_at.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "return_number": r.return_number,
            "invoice_number": r.invoice_number,
            "customer_name": r.customer_name,
            "cashier_name": r.cashier_name,
            "total_refund": r.total_refund,
            "refund_method": r.refund_method,
            "reason": r.reason,
            "items_count": len(r.items),
            "created_at": r.created_at.strftime("%Y-%m-%d %I:%M %p")
        }
        for r in returns
    ]

def get_sales_return_detail(db: Session, return_id: int):
    r = db.query(models.SalesReturn).filter(models.SalesReturn.id == return_id).first()
    if not r:
        return None
    return {
        "id": r.id,
        "return_number": r.return_number,
        "invoice_number": r.invoice_number,
        "customer_name": r.customer_name,
        "customer_phone": r.customer_phone,
        "cashier_name": r.cashier_name,
        "employee_id": r.employee_id,
        "total_refund": r.total_refund,
        "refund_method": r.refund_method,
        "reason": r.reason,
        "notes": r.notes,
        "created_at": r.created_at.strftime("%Y-%m-%d %I:%M %p"),
        "items": [
            {
                "id": i.id,
                "product_id": i.product_id,
                "product_name": i.product_name,
                "barcode": i.barcode,
                "returned_quantity": i.returned_quantity,
                "unit": i.unit,
                "unit_price": i.unit_price,
                "refund_amount": i.refund_amount,
                "restock_condition": i.restock_condition
            }
            for i in r.items
        ]
    }

# ================= PURCHASE RETURNS ================= #

def generate_purchase_return_number(db: Session):
    today_str = datetime.datetime.now().strftime("%Y%m")
    count = db.query(models.PurchaseReturn).count()
    return f"PR-{today_str}-{(count + 1):04d}"

def create_purchase_return(db: Session, req: schemas.PurchaseReturnCreate, user_info: dict = None):
    user_name = user_info.get("name", "Store Owner") if user_info else "Store Owner"
    supp = db.query(models.Supplier).filter(models.Supplier.id == req.supplier_id).first()
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == req.purchase_order_id).first() if req.purchase_order_id else None
    
    ret_num = generate_purchase_return_number(db)
    total_refund = 0.0
    return_items_to_add = []
    
    for it in req.items:
        prod = db.query(models.Product).filter(models.Product.id == it.product_id).first()
        if not prod:
            continue
        unit_p = it.unit_price if (it.unit_price is not None and it.unit_price > 0) else prod.cost_price
        line_refund = round(unit_p * it.returned_quantity, 2)
        total_refund += line_refund
        
        # Deduct returned quantity from current store stock
        prod.stock_qty = max(0.0, prod.stock_qty - it.returned_quantity)
        record_stock_movement(
            db=db,
            product_id=prod.id,
            product_name=prod.name,
            barcode=prod.barcode,
            movement_type="PURCHASE_RETURN",
            quantity_change=-float(it.returned_quantity),
            balance_after=float(prod.stock_qty),
            reference_type="PURCHASE_RETURN",
            reference_id=ret_num,
            reason=f"Purchase Return to {supp.name if supp else 'Supplier'} ({req.reason})",
            user_name=user_name
        )

        return_items_to_add.append({
            "product_id": prod.id,
            "product_name": prod.name,
            "barcode": prod.barcode,
            "returned_quantity": it.returned_quantity,
            "unit_price": unit_p,
            "refund_amount": line_refund
        })

    # Adjust supplier PO due amount if linked
    if po:
        po.due_amount = max(0.0, round(float(getattr(po, "due_amount", 0.0)) - total_refund, 2))

    ret_record = models.PurchaseReturn(
        return_number=ret_num,
        purchase_order_id=po.id if po else None,
        po_number=po.po_number if po else req.po_number,
        supplier_id=req.supplier_id,
        supplier_name=supp.name if supp else "Supplier",
        total_refund=round(total_refund, 2),
        refund_method="SUPPLIER_CREDIT",
        reason=req.reason,
        notes=req.notes,
        created_at=datetime.datetime.utcnow()
    )
    db.add(ret_record)
    db.flush()

    for item_data in return_items_to_add:
        item_obj = models.PurchaseReturnItem(
            purchase_return_id=ret_record.id,
            **item_data
        )
        db.add(item_obj)

    log_audit_event(
        db=db,
        username=user_name,
        role="OWNER",
        action="PURCHASE_RETURN",
        entity="PURCHASE",
        entity_id=ret_num,
        new_value=f"Refund: Rs {total_refund}, Supplier: {supp.name if supp else 'Supplier'}",
        details=f"Reason: {req.reason}"
    )

    db.commit()
    db.refresh(ret_record)
    return {
        "id": ret_record.id,
        "return_number": ret_record.return_number,
        "po_number": ret_record.po_number,
        "supplier_name": ret_record.supplier_name,
        "total_refund": ret_record.total_refund,
        "reason": ret_record.reason,
        "created_at": ret_record.created_at.strftime("%Y-%m-%d %I:%M %p")
    }

def get_purchase_returns(db: Session, limit: int = 100):
    returns = db.query(models.PurchaseReturn).order_by(models.PurchaseReturn.created_at.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "return_number": r.return_number,
            "po_number": r.po_number or "N/A",
            "supplier_name": r.supplier_name,
            "total_refund": r.total_refund,
            "refund_method": r.refund_method,
            "reason": r.reason,
            "items_count": len(r.items),
            "created_at": r.created_at.strftime("%Y-%m-%d %I:%M %p")
        }
        for r in returns
    ]

# ================= STOCK MOVEMENT HISTORY ================= #

def get_stock_movements(db: Session, product_id: int = None, movement_type: str = None, limit: int = 200):
    query = db.query(models.StockMovement)
    if product_id:
        query = query.filter(models.StockMovement.product_id == product_id)
    if movement_type and movement_type != "ALL":
        query = query.filter(models.StockMovement.movement_type == movement_type)
    
    movements = query.order_by(models.StockMovement.created_at.desc()).limit(limit).all()
    return [
        {
            "id": m.id,
            "product_id": m.product_id,
            "product_name": m.product_name,
            "barcode": m.barcode,
            "movement_type": m.movement_type,
            "quantity_change": m.quantity_change,
            "balance_after": m.balance_after,
            "reference_type": m.reference_type,
            "reference_id": m.reference_id,
            "reason": m.reason,
            "user_name": m.user_name,
            "created_at": m.created_at.strftime("%Y-%m-%d %I:%M:%S %p")
        }
        for m in movements
    ]

# ================= BATCH & EXPIRY MANAGEMENT ================= #

def create_product_batch(db: Session, req: schemas.ProductBatchCreate):
    prod = db.query(models.Product).filter(models.Product.id == req.product_id).first()
    if not prod:
        return None
    
    # Mark product as has_batch
    prod.has_batch = True
    
    batch = models.ProductBatch(
        product_id=req.product_id,
        batch_number=req.batch_number.strip(),
        mfg_date=req.mfg_date,
        expiry_date=req.expiry_date,
        quantity=req.quantity,
        cost_price=req.cost_price or prod.cost_price,
        selling_price=req.selling_price or prod.selling_price,
        supplier_id=req.supplier_id,
        purchase_order_id=req.purchase_order_id,
        status="ACTIVE",
        created_at=datetime.datetime.utcnow()
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return {
        "id": batch.id,
        "product_id": batch.product_id,
        "product_name": prod.name,
        "batch_number": batch.batch_number,
        "expiry_date": batch.expiry_date,
        "quantity": batch.quantity,
        "status": batch.status
    }

def get_product_batches(db: Session, product_id: int = None):
    query = db.query(models.ProductBatch)
    if product_id:
        query = query.filter(models.ProductBatch.product_id == product_id)
    batches = query.order_by(models.ProductBatch.expiry_date.asc()).all()
    
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    results = []
    for b in batches:
        is_expired = b.expiry_date and b.expiry_date < today_str
        results.append({
            "id": b.id,
            "product_id": b.product_id,
            "product_name": b.product.name if b.product else "N/A",
            "barcode": b.product.barcode if b.product else "",
            "batch_number": b.batch_number,
            "mfg_date": b.mfg_date,
            "expiry_date": b.expiry_date,
            "quantity": b.quantity,
            "cost_price": b.cost_price,
            "selling_price": b.selling_price,
            "supplier_name": b.supplier.name if b.supplier else "N/A",
            "status": "EXPIRED" if is_expired else b.status,
            "is_expired": is_expired
        })
    return results

def get_expiry_alerts(db: Session):
    today = datetime.date.today()
    d7 = (today + datetime.timedelta(days=7)).strftime("%Y-%m-%d")
    d30 = (today + datetime.timedelta(days=30)).strftime("%Y-%m-%d")
    today_str = today.strftime("%Y-%m-%d")

    batches = db.query(models.ProductBatch).filter(
        models.ProductBatch.status == "ACTIVE",
        models.ProductBatch.quantity > 0
    ).all()

    expired = []
    expiring_7d = []
    expiring_30d = []

    for b in batches:
        if not b.expiry_date:
            continue
        pname = b.product.name if b.product else "Product"
        bdata = {
            "id": b.id,
            "product_id": b.product_id,
            "product_name": pname,
            "barcode": b.product.barcode if b.product else "",
            "batch_number": b.batch_number,
            "expiry_date": b.expiry_date,
            "quantity": b.quantity,
            "rack_location": b.product.rack_location if b.product else "A-01"
        }
        if b.expiry_date < today_str:
            expired.append(bdata)
        elif b.expiry_date <= d7:
            expiring_7d.append(bdata)
        elif b.expiry_date <= d30:
            expiring_30d.append(bdata)

    return {
        "expired_count": len(expired),
        "expiring_7d_count": len(expiring_7d),
        "expiring_30d_count": len(expiring_30d),
        "expired_batches": expired,
        "expiring_7d_batches": expiring_7d,
        "expiring_30d_batches": expiring_30d
    }

# ================= CASHIER SHIFT MANAGEMENT ================= #

def open_cashier_shift(db: Session, cashier_name: str, register_number: str = "REG-01", opening_cash: float = 0.0):
    shift = models.Shift(
        cashier_name=cashier_name,
        register_number=register_number,
        opened_at=datetime.datetime.utcnow(),
        opening_cash=float(opening_cash),
        expected_cash=float(opening_cash),
        status="OPEN"
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    
    log_audit_event(
        db=db,
        username=cashier_name,
        action="SHIFT_OPEN",
        entity="SHIFT",
        entity_id=str(shift.id),
        new_value=f"Opening Cash: Rs {opening_cash}, Register: {register_number}"
    )
    return {
        "id": shift.id,
        "cashier_name": shift.cashier_name,
        "register_number": shift.register_number,
        "opened_at": format_datetime_12h(shift.opened_at),
        "opening_cash": shift.opening_cash,
        "status": shift.status
    }

def get_shifts_list(db: Session, limit: int = 50):
    shifts = db.query(models.Shift).order_by(models.Shift.opened_at.desc()).limit(limit).all()
    return [
        {
            "id": s.id,
            "cashier_name": s.cashier_name,
            "register_number": s.register_number,
            "opened_at": format_datetime_12h(s.opened_at),
            "closed_at": format_datetime_12h(s.closed_at) if s.closed_at else None,
            "opening_cash": s.opening_cash,
            "closing_cash": s.closing_cash,
            "expected_cash": s.expected_cash,
            "actual_cash": s.actual_cash,
            "cash_difference": s.cash_difference,
            "total_sales": s.total_sales,
            "total_transactions": s.total_transactions,
            "status": s.status,
            "notes": s.notes
        }
        for s in shifts
    ]

def get_active_shift(db: Session, cashier_name: str = None):
    query = db.query(models.Shift).filter(models.Shift.status == "OPEN")
    if cashier_name:
        query = query.filter(models.Shift.cashier_name == cashier_name)
    shift = query.order_by(models.Shift.opened_at.desc()).first()
    if not shift:
        return None
    
    # Calculate live sales for this shift
    orders = db.query(models.Order).filter(models.Order.shift_id == shift.id).all()
    cash_sales = sum(o.grand_total for o in orders if o.payment_method == "CASH")
    upi_sales = sum(o.grand_total for o in orders if o.payment_method == "UPI")
    card_sales = sum(o.grand_total for o in orders if o.payment_method == "CARD")
    
    expected_cash = shift.opening_cash + cash_sales
    return {
        "id": shift.id,
        "cashier_name": shift.cashier_name,
        "register_number": shift.register_number,
        "opened_at": format_datetime_12h(shift.opened_at),
        "opening_cash": shift.opening_cash,
        "cash_sales": round(cash_sales, 2),
        "upi_sales": round(upi_sales, 2),
        "card_sales": round(card_sales, 2),
        "total_sales": round(sum(o.grand_total for o in orders), 2),
        "expected_cash": round(expected_cash, 2),
        "transactions_count": len(orders),
        "status": shift.status
    }

# ================= PROMOTIONS & COUPONS ================= #

def get_promotions(db: Session, active_only: bool = False):
    query = db.query(models.Promotion)
    if active_only:
        query = query.filter(models.Promotion.is_active == True)
    promos = query.order_by(models.Promotion.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "code": p.code,
            "title": p.title,
            "description": p.description,
            "discount_type": p.discount_type,
            "discount_value": p.discount_value,
            "min_bill_amount": p.min_bill_amount,
            "max_discount_amount": p.max_discount_amount,
            "product_id": p.product_id,
            "category_name": p.category_name,
            "start_date": p.start_date,
            "end_date": p.end_date,
            "usage_limit": p.usage_limit,
            "used_count": p.used_count,
            "is_active": p.is_active,
            "created_at": p.created_at.strftime("%Y-%m-%d")
        }
        for p in promos
    ]

def create_promotion(db: Session, req: schemas.PromotionCreate):
    code_upper = req.code.strip().upper()
    existing = db.query(models.Promotion).filter(models.Promotion.code == code_upper).first()
    if existing:
        return None
    
    promo = models.Promotion(
        code=code_upper,
        title=req.title,
        description=req.description,
        discount_type=req.discount_type,
        discount_value=req.discount_value,
        min_bill_amount=req.min_bill_amount or 0.0,
        max_discount_amount=req.max_discount_amount,
        product_id=req.product_id,
        category_name=req.category_name,
        start_date=req.start_date,
        end_date=req.end_date,
        usage_limit=req.usage_limit,
        is_active=req.is_active if req.is_active is not None else True,
        created_at=datetime.datetime.utcnow()
    )
    db.add(promo)
    db.commit()
    db.refresh(promo)
    return promo

def validate_and_apply_coupon(db: Session, coupon_code: str, bill_subtotal: float, items: list = None):
    code_clean = coupon_code.strip().upper()
    promo = db.query(models.Promotion).filter(models.Promotion.code == code_clean, models.Promotion.is_active == True).first()
    if not promo:
        return {"valid": False, "discount_amount": 0.0, "message": f"Coupon code '{coupon_code}' is invalid or expired."}
    
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    if promo.start_date and promo.start_date > today_str:
        return {"valid": False, "discount_amount": 0.0, "message": f"Coupon is not active yet (starts {promo.start_date})."}
    if promo.end_date and promo.end_date < today_str:
        return {"valid": False, "discount_amount": 0.0, "message": f"Coupon expired on {promo.end_date}."}
    if promo.usage_limit and (promo.used_count or 0) >= promo.usage_limit:
        return {"valid": False, "discount_amount": 0.0, "message": "Coupon usage limit has been reached."}
    if bill_subtotal < (promo.min_bill_amount or 0.0):
        return {"valid": False, "discount_amount": 0.0, "message": f"Minimum bill amount of Rs {promo.min_bill_amount:.2f} required for this coupon."}

    # Calculate discount
    discount_amount = 0.0
    if promo.discount_type == "PERCENTAGE":
        discount_amount = bill_subtotal * (promo.discount_value / 100.0)
        if promo.max_discount_amount and discount_amount > promo.max_discount_amount:
            discount_amount = promo.max_discount_amount
    elif promo.discount_type == "FIXED":
        discount_amount = min(bill_subtotal, promo.discount_value)
    elif promo.discount_type == "BOGO":
        discount_amount = min(bill_subtotal * 0.5, promo.discount_value or bill_subtotal)

    discount_amount = round(discount_amount, 2)
    return {
        "valid": True,
        "coupon_code": promo.code,
        "title": promo.title,
        "discount_type": promo.discount_type,
        "discount_amount": discount_amount,
        "message": f"Coupon '{promo.code}' applied successfully! Saved Rs {discount_amount:.2f}"
    }

# ================= AUDIT LOGS ================= #

def get_audit_logs(db: Session, action: str = None, entity: str = None, limit: int = 200):
    query = db.query(models.AuditLog)
    if action and action != "ALL":
        query = query.filter(models.AuditLog.action == action)
    if entity and entity != "ALL":
        query = query.filter(models.AuditLog.entity == entity)
    
    logs = query.order_by(models.AuditLog.created_at.desc()).limit(limit).all()
    return [
        {
            "id": l.id,
            "username": l.username,
            "employee_id": l.employee_id or "N/A",
            "role": l.role,
            "action": l.action,
            "entity": l.entity or "GENERAL",
            "entity_id": l.entity_id or "",
            "old_value": l.old_value,
            "new_value": l.new_value,
            "details": l.details,
            "created_at": l.created_at.strftime("%Y-%m-%d %I:%M:%S %p")
        }
        for l in logs
    ]

# ================= SMART REORDER RECOMMENDATION ================= #

def get_smart_reorder_recommendations(db: Session):
    products = db.query(models.Product).filter(models.Product.is_active == True).all()
    thirty_days_ago = datetime.datetime.utcnow() - datetime.timedelta(days=30)
    
    # Calculate sold quantities in last 30 days
    sales_query = db.query(
        models.OrderItem.product_id,
        func.sum(models.OrderItem.quantity).label("total_sold")
    ).join(models.Order, models.OrderItem.order_id == models.Order.id)\
     .filter(models.Order.created_at >= thirty_days_ago, models.Order.status == "COMPLETED")\
     .group_by(models.OrderItem.product_id).all()
    
    sales_map = {r[0]: float(r[1] or 0.0) for r in sales_query}
    
    recommendations = []
    for p in products:
        total_30d = sales_map.get(p.id, 0.0)
        daily_avg = round(total_30d / 30.0, 2)
        lead_time_days = 5.0 # Standard retail lead time
        
        # Target stock = (Daily Sales * Lead Time) + Safety Stock (min_stock)
        target_stock = (daily_avg * lead_time_days) + p.min_stock
        deficit = target_stock - p.stock_qty
        reorder_qty = max(0.0, round(deficit, 1))
        
        urgency = "NORMAL"
        if p.stock_qty <= 0:
            urgency = "CRITICAL (OUT OF STOCK)"
        elif p.stock_qty <= p.min_stock:
            urgency = "HIGH (BELOW MINIMUM)"
        elif reorder_qty > 0:
            urgency = "MEDIUM"
        
        if reorder_qty > 0 or p.stock_qty <= p.min_stock:
            supp = p.supplier_id and db.query(models.Supplier).filter(models.Supplier.id == p.supplier_id).first()
            recommendations.append({
                "product_id": p.id,
                "name": p.name,
                "barcode": p.barcode,
                "category": p.category,
                "current_stock": p.stock_qty,
                "min_stock": p.min_stock,
                "unit": p.unit,
                "cost_price": p.cost_price,
                "daily_avg_sales": daily_avg,
                "total_sold_30d": total_30d,
                "recommended_reorder_qty": reorder_qty if reorder_qty > 0 else p.min_stock,
                "urgency": urgency,
                "supplier_id": p.supplier_id,
                "supplier_name": supp.name if supp else "Direct FMCG",
                "estimated_po_cost": round((reorder_qty if reorder_qty > 0 else p.min_stock) * p.cost_price, 2)
            })
            
    # Sort by urgency and deficit
    recommendations.sort(key=lambda x: (x["current_stock"] <= 0, x["current_stock"] <= x["min_stock"], x["recommended_reorder_qty"]), reverse=True)
    return recommendations

# ================= ADVANCED DATABASE REPORTS ================= #

def get_advanced_reports(db: Session, report_type: str = "sales_summary", start_date: str = None, end_date: str = None):
    today = datetime.date.today()
    if not start_date:
        start_date = (today - datetime.timedelta(days=30)).strftime("%Y-%m-%d")
    if not end_date:
        end_date = today.strftime("%Y-%m-%d")

    start_dt = datetime.datetime.strptime(f"{start_date} 00:00:00", "%Y-%m-%d %H:%M:%S")
    end_dt = datetime.datetime.strptime(f"{end_date} 23:59:59", "%Y-%m-%d %H:%M:%S")

    if report_type == "sales_by_date":
        orders = db.query(models.Order).filter(
            models.Order.created_at >= start_dt,
            models.Order.created_at <= end_dt,
            models.Order.status == "COMPLETED"
        ).order_by(models.Order.created_at.asc()).all()

        date_map = {}
        for o in orders:
            d_str = o.created_at.strftime("%Y-%m-%d")
            if d_str not in date_map:
                date_map[d_str] = {"date": d_str, "bills": 0, "sales": 0.0, "tax": 0.0, "profit": 0.0}
            date_map[d_str]["bills"] += 1
            date_map[d_str]["sales"] += o.grand_total
            date_map[d_str]["tax"] += (o.tax_amount or 0.0)
            date_map[d_str]["profit"] += sum((i.unit_price - i.cost_price) * i.quantity for i in o.items)

        return [
            {k: (round(v, 2) if isinstance(v, float) else v) for k, v in row.items()}
            for row in date_map.values()
        ]

    elif report_type == "sales_by_cashier":
        orders = db.query(models.Order).filter(
            models.Order.created_at >= start_dt,
            models.Order.created_at <= end_dt,
            models.Order.status == "COMPLETED"
        ).all()

        cashier_map = {}
        for o in orders:
            cname = o.cashier_name or o.employee_id or "Unassigned"
            if cname not in cashier_map:
                cashier_map[cname] = {"cashier": cname, "bills": 0, "sales": 0.0, "cash": 0.0, "upi": 0.0, "card": 0.0}
            cashier_map[cname]["bills"] += 1
            cashier_map[cname]["sales"] += o.grand_total
            if o.payment_method == "CASH":
                cashier_map[cname]["cash"] += o.grand_total
            elif o.payment_method == "UPI":
                cashier_map[cname]["upi"] += o.grand_total
            elif o.payment_method == "CARD":
                cashier_map[cname]["card"] += o.grand_total

        return [
            {k: (round(v, 2) if isinstance(v, float) else v) for k, v in row.items()}
            for row in cashier_map.values()
        ]

    elif report_type == "profit_summary":
        orders = db.query(models.Order).filter(
            models.Order.created_at >= start_dt,
            models.Order.created_at <= end_dt,
            models.Order.status == "COMPLETED"
        ).all()

        total_sales = sum(o.grand_total for o in orders)
        total_cogs = sum(sum(i.cost_price * i.quantity for i in o.items) for o in orders)
        gross_profit = total_sales - total_cogs
        margin_pct = (gross_profit / total_sales * 100.0) if total_sales > 0 else 0.0

        return {
            "period": f"{start_date} to {end_date}",
            "total_bills": len(orders),
            "total_sales": round(total_sales, 2),
            "cost_of_goods_sold": round(total_cogs, 2),
            "gross_profit": round(gross_profit, 2),
            "profit_margin_pct": round(margin_pct, 2)
        }

    else:
        # Default full summary
        return {
            "top_products": get_top_selling_products(db, limit=10),
            "category_sales": get_category_sales(db),
            "hourly_sales": get_hourly_sales(db)
        }

# ================= DATABASE BACKUP & RECOVERY ================= #

def get_backup_dir():
    import os
    backup_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backups")
    if not os.path.exists(backup_dir):
        os.makedirs(backup_dir, exist_ok=True)
    return backup_dir

def create_database_backup(db: Session = None):
    import shutil
    import os
    from .database import DB_PATH
    
    backup_dir = get_backup_dir()
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"supermarket_backup_{timestamp}.db"
    backup_filepath = os.path.join(backup_dir, backup_filename)
    
    if os.path.exists(DB_PATH):
        shutil.copy2(DB_PATH, backup_filepath)
        size_kb = round(os.path.getsize(backup_filepath) / 1024.0, 2)
        if db:
            log_audit_event(
                db=db,
                action="BACKUP_CREATED",
                entity="DATABASE",
                entity_id=backup_filename,
                details=f"Backup snapshot created ({size_kb} KB)"
            )
            db.commit()
        return {
            "success": True,
            "filename": backup_filename,
            "size_kb": size_kb,
            "created_at": datetime.datetime.now().strftime("%Y-%m-%d %I:%M:%S %p"),
            "message": f"Database backup '{backup_filename}' created successfully."
        }
    return {"success": False, "message": "Source database file not found."}

def list_database_backups():
    import os
    backup_dir = get_backup_dir()
    files = [f for f in os.listdir(backup_dir) if f.endswith(".db")]
    results = []
    for f in sorted(files, reverse=True):
        fpath = os.path.join(backup_dir, f)
        mtime = datetime.datetime.fromtimestamp(os.path.getmtime(fpath))
        size_kb = round(os.path.getsize(fpath) / 1024.0, 2)
        results.append({
            "filename": f,
            "size_kb": size_kb,
            "created_at": mtime.strftime("%Y-%m-%d %I:%M:%S %p")
        })
    return results

def restore_database_backup(filename: str, db: Session = None):
    import shutil
    import os
    from .database import DB_PATH
    
    backup_dir = get_backup_dir()
    source_backup = os.path.join(backup_dir, filename)
    
    if not os.path.exists(source_backup):
        return {"success": False, "message": f"Backup file '{filename}' not found."}
    
    # 1. Create a safety snapshot of current DB before restoring
    create_database_backup()
    
    # 2. Safely restore
    shutil.copy2(source_backup, DB_PATH)
    return {
        "success": True,
        "message": f"Database successfully restored from '{filename}'. Current state pre-snapshot was saved."
    }

# ================= AI BUSINESS ASSISTANT ================= #

def ask_ai_business_assistant(db: Session, question: str):
    q_lower = question.lower().strip()
    
    today = datetime.date.today()
    start_of_today = datetime.datetime(today.year, today.month, today.day, 0, 0, 0)
    
    # Query 1: Sales / Revenue today or general
    if "today" in q_lower and ("sale" in q_lower or "revenue" in q_lower or "performance" in q_lower or "how much" in q_lower):
        orders = db.query(models.Order).filter(models.Order.created_at >= start_of_today, models.Order.status == "COMPLETED").all()
        today_sales = sum(o.grand_total for o in orders)
        today_bills = len(orders)
        today_profit = sum(sum((i.unit_price - i.cost_price) * i.quantity for i in o.items) for o in orders)
        
        return {
            "answer": f"Today's total revenue is **₹{today_sales:,.2f}** across **{today_bills} completed bills**, with an estimated gross profit of **₹{today_profit:,.2f}**.",
            "metrics": {
                "Today's Sales": f"₹{today_sales:,.2f}",
                "Total Bills": today_bills,
                "Estimated Profit": f"₹{today_profit:,.2f}",
                "Average Bill Value": f"₹{(today_sales / today_bills):,.2f}" if today_bills > 0 else "₹0.00"
            },
            "source": "Live SQLite orders table for today's timestamp."
        }
        
    # Query 2: Reorder / Low stock
    elif "reorder" in q_lower or "low stock" in q_lower or "shortage" in q_lower or "stock alert" in q_lower:
        reorders = get_smart_reorder_recommendations(db)
        top_reorders = reorders[:5]
        if not top_reorders:
            return {
                "answer": "All products currently have healthy inventory levels above their minimum stock thresholds.",
                "metrics": {"Products Needing Reorder": 0},
                "source": "Live product catalog vs min_stock levels."
            }
        
        items_summary = "\n".join([f"- **{r['name']}**: Current stock is **{r['current_stock']} {r['unit']}** (Min: {r['min_stock']}). Recommended Reorder: **{r['recommended_reorder_qty']} {r['unit']}** from *{r['supplier_name']}*." for r in top_reorders])
        return {
            "answer": f"There are **{len(reorders)} products** requiring restocking. Here are the top items:\n\n{items_summary}",
            "metrics": {
                "Total Products Needing Reorder": len(reorders),
                "Estimated Reorder PO Total": f"₹{sum(r['estimated_po_cost'] for r in reorders):,.2f}"
            },
            "source": "Live product stock table & 30-day velocity calculation."
        }

    # Query 3: Top selling products
    elif "top" in q_lower or "best selling" in q_lower or "popular" in q_lower:
        top_prods = get_top_selling_products(db, limit=5)
        if not top_prods:
            return {
                "answer": "No sales records found yet to compute top selling items.",
                "metrics": {},
                "source": "Order items table."
            }
        items_summary = "\n".join([f"{idx+1}. **{p['name']}** — **{p['qty_sold']} units** sold (Revenue: ₹{p['revenue']:,.2f})" for idx, p in enumerate(top_prods)])
        return {
            "answer": f"Here are the **Top 5 Selling Products**:\n\n{items_summary}",
            "metrics": {
                "Top Item": top_prods[0]["name"],
                "Top Item Revenue": f"₹{top_prods[0]['revenue']:,.2f}"
            },
            "source": "Aggregated order_items sales volume."
        }

    # Query 4: Supplier dues / Outstanding
    elif "supplier" in q_lower or "outstanding" in q_lower or "due" in q_lower:
        pos = db.query(models.PurchaseOrder).all()
        total_due = sum(float(getattr(po, "due_amount", 0.0)) for po in pos)
        
        # Group by supplier
        supp_due = {}
        for po in pos:
            due = float(getattr(po, "due_amount", 0.0))
            if due > 0:
                sname = po.supplier.name if po.supplier else "Supplier"
                supp_due[sname] = supp_due.get(sname, 0.0) + due
        
        sorted_supps = sorted(supp_due.items(), key=lambda x: x[1], reverse=True)
        top_due_summary = "\n".join([f"- **{s[0]}**: Pending Due **₹{s[1]:,.2f}**" for s in sorted_supps[:5]])
        
        return {
            "answer": f"Total outstanding supplier balance is **₹{total_due:,.2f}** across **{len(supp_due)} suppliers** with pending invoices.\n\n{top_due_summary if top_due_summary else 'No pending dues!'}",
            "metrics": {
                "Total Supplier Outstanding": f"₹{total_due:,.2f}",
                "Suppliers with Pending Due": len(supp_due)
            },
            "source": "Purchase Orders due_amount ledger."
        }

    # Query 5: Expiry / Expired products
    elif "expiry" in q_lower or "expired" in q_lower or "fefo" in q_lower:
        alerts = get_expiry_alerts(db)
        return {
            "answer": f"Found **{alerts['expired_count']} expired batches**, **{alerts['expiring_7d_count']} batches expiring in 7 days**, and **{alerts['expiring_30d_count']} batches expiring within 30 days**.",
            "metrics": {
                "Expired Batches": alerts["expired_count"],
                "Expiring in 7 Days": alerts["expiring_7d_count"],
                "Expiring in 30 Days": alerts["expiring_30d_count"]
            },
            "source": "Product batches table and current system date."
        }

    # Query 6: Profit / Margin
    elif "profit" in q_lower or "margin" in q_lower:
        profit_data = get_advanced_reports(db, report_type="profit_summary")
        return {
            "answer": f"In the last 30 days, gross sales are **₹{profit_data['total_sales']:,.2f}** with Cost of Goods Sold of **₹{profit_data['cost_of_goods_sold']:,.2f}**, yielding a **Gross Profit of ₹{profit_data['gross_profit']:,.2f}** ({profit_data['profit_margin_pct']}% margin).",
            "metrics": profit_data,
            "source": "Live orders & product cost price calculations."
        }

    # General fallback with real store stats
    else:
        total_prods = db.query(models.Product).filter(models.Product.is_active == True).count()
        total_orders = db.query(models.Order).count()
        total_suppliers = db.query(models.Supplier).filter(models.Supplier.is_active == True).count()
        
        return {
            "answer": f"I can assist you with live supermarket analytics! The system currently manages **{total_prods} active products**, **{total_suppliers} suppliers**, and has recorded **{total_orders} total customer bills**.\n\nYou can ask about:\n- Today's sales & profit\n- Top selling products\n- Reorder & low stock alerts\n- Supplier outstanding balances\n- Expiring product batches\n- Monthly profit margins",
            "metrics": {
                "Active Products": total_prods,
                "Suppliers": total_suppliers,
                "Lifetime Bills": total_orders
            },
            "source": "Live Supermarket Database."
        }

# ================= BILL REPRINT ================= #

def reprint_order(db: Session, order_id_or_number: str):
    if order_id_or_number.isdigit():
        order = db.query(models.Order).filter(models.Order.id == int(order_id_or_number)).first()
    else:
        order = db.query(models.Order).filter(models.Order.invoice_number == order_id_or_number).first()
    
    if not order:
        return None
    
    order.is_reprinted = True
    order.reprint_count = (order.reprint_count or 0) + 1
    db.commit()
    db.refresh(order)
    
    items = db.query(models.OrderItem).filter(models.OrderItem.order_id == order.id).all()
    return {
        "id": order.id,
        "invoice_number": order.invoice_number,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "cashier_name": order.cashier_name,
        "employee_id": order.employee_id,
        "register_number": order.register_number,
        "counter_id": getattr(order, "counter_id", "Counter 1") or "Counter 1",
        "subtotal": order.subtotal,
        "tax_amount": order.tax_amount,
        "discount_amount": order.discount_amount,
        "points_discount": order.points_discount,
        "points_redeemed": order.points_redeemed,
        "grand_total": order.grand_total,
        "payment_method": order.payment_method,
        "tendered_amount": getattr(order, "tendered_amount", order.grand_total) or order.grand_total,
        "change_amount": getattr(order, "change_amount", 0.0) or 0.0,
        "payment_details": json.loads(order.payment_details or "{}"),
        "is_reprinted": True,
        "is_duplicate": True,
        "reprint_count": order.reprint_count,
        "created_at": order.created_at.strftime("%Y-%m-%d %I:%M %p"),
        "items": [
            {
                "product_id": i.product_id,
                "name": i.product_name,
                "barcode": i.barcode,
                "quantity": i.quantity,
                "unit": i.unit,
                "unit_price": i.unit_price,
                "tax_rate": i.tax_rate,
                "tax_amount": i.tax_amount,
                "discount_amount": i.discount_amount,
                "total_price": i.total_price
            }
            for i in items
        ]
    }

def delete_promotion(db: Session, promo_id: int):
    promo = db.query(models.Promotion).filter(models.Promotion.id == promo_id).first()
    if not promo:
        return False
    db.delete(promo)
    db.commit()
    return True

def delete_product_batch(db: Session, batch_id: int):
    batch = db.query(models.ProductBatch).filter(models.ProductBatch.id == batch_id).first()
    if not batch:
        return False
    db.delete(batch)
    db.commit()
    return True


