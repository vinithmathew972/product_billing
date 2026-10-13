import os
import json
import datetime
from fastapi import FastAPI, Depends, HTTPException, Query, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from .database import engine, Base, get_db
from . import models, schemas, crud
from .auth import (
    verify_password,
    create_session_token,
    revoke_session_token,
    get_current_user_session,
    require_owner_role,
    require_authenticated_user
)

from .migration import auto_migrate_db
from .seed_data import seed_database

# Auto migrate existing SQLite schema to include any newly added model columns
auto_migrate_db()
Base.metadata.create_all(bind=engine)

# Auto seed if needed
seed_database()

app = FastAPI(
    title="Supermarket Smart Billing & Employee Management POS",
    description="Enterprise-grade Supermarket POS, Employee Attendance, Shifts, Salary & Inventory System",
    version="3.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health_check():
    return {"status": "online", "system": "Supermarket Smart Billing & Inventory POS", "version": "3.0.0"}

@app.post("/api/auth/login")
def login(req: schemas.LoginRequest, db: Session = Depends(get_db)):
    raw_identifier = req.username_or_id or req.username or ""
    identifier = raw_identifier.strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Username or Employee ID is required.")
    user = crud.get_user_by_username_or_id(db, identifier)
    
    if not user:
        raise HTTPException(status_code=400, detail="Invalid Employee ID / Username or Password.")
    
    if user.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="Your account is deactivated. Please contact store owner.")
        
    if not verify_password(req.password.strip(), user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid Employee ID / Username or Password.")
    
    token = create_session_token(
        user_id=user.id,
        employee_id=user.employee_id,
        username=user.username,
        name=user.name,
        role=user.role
    )

    shift_name = user.assigned_shift.name if user.assigned_shift else None
    shift_start = user.assigned_shift.start_time if user.assigned_shift else None
    shift_end = user.assigned_shift.end_time if user.assigned_shift else None
    shift_formatted_range = f"{crud.format_time_12h(shift_start)} - {crud.format_time_12h(shift_end)}" if (shift_start and shift_end) else None

    return {
        "token": token,
        "access_token": token,
        "user": {
            "id": user.id,
            "employee_id": user.employee_id,
            "name": user.name,
            "username": user.username,
            "phone": user.phone,
            "email": user.email,
            "role": user.role,
            "salary_type": user.salary_type,
            "salary_rate": user.salary_rate,
            "assigned_shift_id": user.assigned_shift_id,
            "assigned_shift_name": shift_name,
            "assigned_shift_start": crud.format_time_12h(shift_start) if shift_start else None,
            "assigned_shift_end": crud.format_time_12h(shift_end) if shift_end else None,
            "assigned_shift_formatted": shift_formatted_range,
            "joining_date": user.joining_date,
            "status": user.status
        }
    }

@app.post("/api/auth/logout")
def logout(session: dict = Depends(require_authenticated_user)):
    # Handled via auth header in request
    return {"message": "Logged out successfully"}

@app.get("/api/auth/me")
def get_me(session: dict = Depends(require_authenticated_user), db: Session = Depends(get_db)):
    user = crud.get_user_by_id(db, session["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    shift_name = user.assigned_shift.name if user.assigned_shift else None
    shift_start = user.assigned_shift.start_time if user.assigned_shift else None
    shift_end = user.assigned_shift.end_time if user.assigned_shift else None
    shift_formatted_range = f"{crud.format_time_12h(shift_start)} - {crud.format_time_12h(shift_end)}" if (shift_start and shift_end) else None

    return {
        "id": user.id,
        "employee_id": user.employee_id,
        "name": user.name,
        "username": user.username,
        "phone": user.phone,
        "email": user.email,
        "role": user.role,
        "salary_type": user.salary_type,
        "salary_rate": user.salary_rate,
        "assigned_shift_id": user.assigned_shift_id,
        "assigned_shift_name": shift_name,
        "assigned_shift_start": crud.format_time_12h(shift_start) if shift_start else None,
        "assigned_shift_end": crud.format_time_12h(shift_end) if shift_end else None,
        "assigned_shift_formatted": shift_formatted_range,
        "joining_date": user.joining_date,
        "status": user.status
    }

@app.get("/api/owner/dashboard")
@app.get("/api/owner/dashboard-metrics")
def get_owner_dashboard(session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    return crud.get_owner_dashboard_summary(db)

@app.get("/api/owner/employees")
def list_employees(
    search: Optional[str] = None,
    status: Optional[str] = None,
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    employees = crud.get_employees(db, search=search, status=status)
    return [
        {
            "id": e.id,
            "employee_id": e.employee_id,
            "name": e.name,
            "username": e.username,
            "phone": e.phone,
            "email": e.email,
            "role": e.role,
            "salary_type": e.salary_type,
            "salary_rate": e.salary_rate,
            "assigned_shift_id": e.assigned_shift_id,
            "assigned_shift_name": e.assigned_shift.name if e.assigned_shift else "Not Assigned",
            "assigned_shift_start": crud.format_time_12h(e.assigned_shift.start_time) if (e.assigned_shift and e.assigned_shift.start_time) else None,
            "assigned_shift_end": crud.format_time_12h(e.assigned_shift.end_time) if (e.assigned_shift and e.assigned_shift.end_time) else None,
            "assigned_shift_formatted": f"{crud.format_time_12h(e.assigned_shift.start_time)} - {crud.format_time_12h(e.assigned_shift.end_time)}" if (e.assigned_shift and e.assigned_shift.start_time and e.assigned_shift.end_time) else "Not Assigned",
            "joining_date": e.joining_date,
            "status": e.status
        }
        for e in employees
    ]

@app.post("/api/owner/employees")
def create_new_employee(
    emp: schemas.EmployeeCreate,
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    created = crud.create_employee(db, emp)
    if not created:
        raise HTTPException(status_code=400, detail=f"Employee with ID '{emp.employee_id}' or username already exists.")
    return {"message": "Employee created successfully", "employee_id": created.employee_id}

@app.put("/api/owner/employees/{user_id}")
def update_existing_employee(
    user_id: int,
    emp_update: schemas.EmployeeUpdate,
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    updated = crud.update_employee(db, user_id, emp_update)
    if not updated:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": "Employee updated successfully"}

@app.delete("/api/owner/employees/{user_id}")
def delete_existing_employee(
    user_id: int,
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    success = crud.delete_employee(db, user_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot deactivate employee or owner.")
    return {"message": "Employee deactivated successfully"}

@app.get("/api/owner/shifts")
def get_work_shifts_list(db: Session = Depends(get_db)):
    shifts = crud.get_work_shifts(db)
    return [
        {
            "id": s.id,
            "name": s.name,
            "start_time": s.start_time,
            "end_time": s.end_time,
            "formatted_start_time": crud.format_time_12h(s.start_time),
            "formatted_end_time": crud.format_time_12h(s.end_time),
            "formatted_range": f"{crud.format_time_12h(s.start_time)} - {crud.format_time_12h(s.end_time)}",
            "description": s.description,
            "is_active": s.is_active
        }
        for s in shifts
    ]

@app.post("/api/owner/shifts")
def create_shift_definition(
    shift_data: schemas.WorkShiftCreate,
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    s = crud.create_work_shift(db, shift_data)
    return {
        "id": s.id,
        "name": s.name,
        "start_time": s.start_time,
        "end_time": s.end_time,
        "formatted_start_time": crud.format_time_12h(s.start_time),
        "formatted_end_time": crud.format_time_12h(s.end_time),
        "formatted_range": f"{crud.format_time_12h(s.start_time)} - {crud.format_time_12h(s.end_time)}",
        "description": s.description,
        "is_active": s.is_active
    }

@app.get("/api/owner/attendance")
def get_attendance_records(
    date_filter: str = "today",
    filter: Optional[str] = None,
    custom_date: Optional[str] = None,
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    effective_filter = filter or date_filter
    attendances = crud.get_attendances(db, date_filter=effective_filter, custom_date=custom_date)
    return [
        {
            "id": a.id,
            "employee_id": a.employee_id,
            "employee_code": a.employee_code,
            "employee_name": a.employee_name,
            "shift_name": a.shift_name,
            "date": a.date,
            "check_in_time": crud.format_time_12h(a.check_in_time),
            "check_out_time": crud.format_time_12h(a.check_out_time) if a.check_out_time else "—",
            "working_duration": f"{a.working_minutes // 60}h {a.working_minutes % 60:02d}m" if a.working_minutes else ("In Progress" if a.status == "WORKING" else "—"),
            "late_minutes": a.late_minutes,
            "is_late": (a.late_minutes or 0) > 0,
            "status": a.status,
            "bills_count": a.bills_count,
            "shift_sales": a.total_sales,
            "total_sales": a.total_sales,
            "notes": a.notes
        }
        for a in attendances
    ]

@app.get("/api/owner/salaries")
@app.get("/api/owner/salary-records")
def get_salaries(
    month_year: Optional[str] = None,
    month: Optional[str] = None,
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    m = month or month_year
    if not m:
        m = datetime.date.today().strftime("%Y-%m")
    records = crud.get_salary_records(db, month_year=m)
    return [
        {
            "id": r.id,
            "employee_id": r.employee_id,
            "employee_code": r.employee_code,
            "employee_name": r.employee_name,
            "month_year": r.month_year,
            "month": r.month_year,
            "salary_type": r.salary_type,
            "salary_rate": r.salary_rate,
            "base_salary_rate": r.salary_rate,
            "present_days": r.present_days,
            "absent_days": r.absent_days,
            "late_days": r.late_days,
            "total_working_hours": r.total_working_hours,
            "total_hours_worked": r.total_working_hours,
            "calculated_salary": r.calculated_salary,
            "paid_amount": r.paid_amount,
            "payment_status": r.payment_status,
            "payment_date": r.payment_date.strftime("%Y-%m-%d %I:%M %p") if r.payment_date else None,
            "paid_at": r.payment_date.strftime("%Y-%m-%d %I:%M %p") if r.payment_date else None,
            "payment_method": r.payment_method,
            "payment_reference": r.payment_reference,
            "transaction_ref": r.payment_reference,
            "notes": r.notes
        }
        for r in records
    ]

@app.post("/api/owner/salaries/pay")
def pay_employee_salary(
    req: schemas.SalaryPayRequest,
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    paid = crud.pay_salary(
        db,
        salary_record_id=req.salary_record_id,
        payment_method=req.payment_method,
        payment_reference=req.payment_reference,
        notes=req.notes
    )
    if not paid:
        raise HTTPException(status_code=404, detail="Salary record not found")
    return {"message": "Salary paid successfully", "record_id": paid.id, "payment_status": paid.payment_status}

@app.post("/api/owner/salary-records/{record_id}/pay")
def pay_salary_record_by_id(
    record_id: int,
    req: Optional[dict] = None,
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    payment_method = (req or {}).get("payment_method", "CASH")
    payment_reference = (req or {}).get("transaction_ref") or (req or {}).get("payment_reference", "")
    paid = crud.pay_salary(
        db,
        salary_record_id=record_id,
        payment_method=payment_method,
        payment_reference=payment_reference
    )
    if not paid:
        raise HTTPException(status_code=404, detail="Salary record not found")
    return {"message": "Salary paid successfully", "record_id": paid.id, "payment_status": paid.payment_status}

@app.get("/api/owner/sales-by-employee")
def get_cashier_sales_leaderboard(
    date_filter: str = "today",
    custom_date: Optional[str] = None,
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    return crud.get_sales_by_employee(db, date_filter=date_filter, custom_date=custom_date)

@app.get("/api/owner/active-workers")
def get_active_workers(
    session: dict = Depends(require_owner_role),
    db: Session = Depends(get_db)
):
    return crud.get_working_now_employees(db)

@app.get("/api/employee/dashboard")
def get_employee_dashboard(
    session: dict = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    return crud.get_employee_dashboard_summary(db, session["user_id"])

@app.post("/api/employee/check-in")
def employee_shift_check_in(
    req: Optional[schemas.AttendanceCheckInRequest] = None,
    session: dict = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    user = crud.get_user_by_id(db, session["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="Employee not found")
        
    shift_id = req.shift_id if req else None
    notes = req.notes if req else None
    att = crud.employee_check_in(db, user, shift_id=shift_id, notes=notes)
    return {
        "message": "Checked in successfully",
        "attendance_id": att.id,
        "check_in_time": crud.format_time_12h(att.check_in_time),
        "late_minutes": att.late_minutes,
        "is_late": att.late_minutes > 0,
        "status": att.status
    }

@app.post("/api/employee/check-out")
def employee_shift_check_out(
    req: Optional[schemas.AttendanceCheckOutRequest] = None,
    session: dict = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    user = crud.get_user_by_id(db, session["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="Employee not found")
        
    active_att = crud.get_active_attendance_for_employee(db, user.id)
    if not active_att:
        raise HTTPException(status_code=400, detail="No active shift currently checked in.")
        
    notes = req.notes if req else None
    completed = crud.employee_check_out(db, active_att.id, notes=notes)
    
    hours = completed.working_minutes // 60
    mins = completed.working_minutes % 60

    return {
        "message": "Shift completed and checked out successfully",
        "attendance_id": completed.id,
        "employee_name": completed.employee_name,
        "shift_name": completed.shift_name,
        "date": completed.date,
        "check_in_time": crud.format_time_12h(completed.check_in_time),
        "check_out_time": crud.format_time_12h(completed.check_out_time) if completed.check_out_time else "—",
        "working_duration": f"{hours}h {mins:02d}m",
        "shift_bills": completed.bills_count,
        "shift_sales": round(completed.total_sales, 2),
        "shift_items_sold": completed.items_sold,
        "bills_count": completed.bills_count,
        "total_sales": round(completed.total_sales, 2),
        "cash_sales": round(completed.cash_sales, 2),
        "upi_sales": round(completed.upi_sales, 2),
        "card_sales": round(completed.card_sales, 2),
        "items_sold": completed.items_sold
    }

@app.get("/api/employee/attendance")
@app.get("/api/employee/my-attendance")
def get_my_attendance(
    session: dict = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    attendances = crud.get_attendances(db, employee_id=session["user_id"], date_filter="this_month")
    return [
        {
            "id": a.id,
            "date": a.date,
            "shift_name": a.shift_name,
            "check_in_time": crud.format_time_12h(a.check_in_time),
            "check_out_time": crud.format_time_12h(a.check_out_time) if a.check_out_time else "—",
            "working_duration": f"{a.working_minutes // 60}h {a.working_minutes % 60:02d}m" if a.working_minutes else ("In Progress" if a.status == "WORKING" else "—"),
            "late_minutes": a.late_minutes,
            "is_late": a.late_minutes > 0,
            "status": a.status,
            "bills_count": a.bills_count,
            "shift_bills": a.bills_count,
            "total_sales": a.total_sales,
            "shift_sales": a.total_sales
        }
        for a in attendances
    ]

@app.get("/api/employee/bills")
@app.get("/api/employee/my-orders")
def get_my_bills(
    session: dict = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    orders = db.query(models.Order).filter(
        models.Order.employee_id == session["employee_id"]
    ).order_by(models.Order.created_at.desc()).limit(50).all()
    
    return [
        {
            "id": o.id,
            "invoice_number": o.invoice_number,
            "customer_name": o.customer_name,
            "grand_total": o.grand_total,
            "payment_method": o.payment_method,
            "items_count": len(o.items),
            "created_at": o.created_at.strftime("%Y-%m-%d %I:%M %p")
        }
        for o in orders
    ]

@app.post("/api/pos/checkout")
def checkout_order(req: schemas.CheckoutRequest, db: Session = Depends(get_db)):
    try:
        order = crud.process_checkout(db, req)
        items = db.query(models.OrderItem).filter(models.OrderItem.order_id == order.id).all()
        return {
            "success": True,
            "id": order.id,
            "order_id": order.id,
            "invoice_number": order.invoice_number,
            "employee_id": order.employee_id,
            "cashier_name": order.cashier_name,
            "grand_total": order.grand_total,
            "subtotal": order.subtotal,
            "tax_amount": order.tax_amount,
            "discount_amount": order.discount_amount,
            "points_discount": order.points_discount,
            "points_redeemed": order.points_redeemed,
            "payment_method": order.payment_method,
            "tendered_amount": getattr(order, "tendered_amount", order.grand_total) or order.grand_total,
            "change_amount": getattr(order, "change_amount", 0.0) or 0.0,
            "payment_details": json.loads(order.payment_details or "{}"),
            "customer_name": order.customer_name,
            "customer_phone": order.customer_phone,
            "register_number": order.register_number,
            "created_at": order.created_at.strftime("%Y-%m-%d %I:%M %p"),
            "items": [
                {
                    "product_id": i.product_id,
                    "name": i.product_name,
                    "barcode": i.barcode,
                    "qty": i.quantity,
                    "unit": i.unit,
                    "unit_price": i.unit_price,
                    "tax_rate": i.tax_rate,
                    "tax_amount": i.tax_amount,
                    "discount_amount": i.discount_amount,
                    "total": i.total_price
                }
                for i in items
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/products", response_model=List[schemas.ProductOut])
def list_products(
    search: Optional[str] = None,
    category: Optional[str] = None,
    low_stock: Optional[bool] = False,
    skip: int = 0,
    limit: int = 500,
    db: Session = Depends(get_db)
):
    return crud.get_products(db, skip=skip, limit=limit, search=search, category=category, low_stock=low_stock)

@app.get("/api/products/barcode/{barcode}", response_model=schemas.ProductOut)
def get_by_barcode(barcode: str, db: Session = Depends(get_db)):
    prod = crud.get_product_by_barcode(db, barcode)
    if not prod:
        raise HTTPException(status_code=404, detail=f"Product with barcode '{barcode}' not found.")
    return prod

@app.get("/api/products/{product_id}", response_model=schemas.ProductOut)
def get_single_product(product_id: int, db: Session = Depends(get_db)):
    prod = crud.get_product(db, product_id)
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    return prod

@app.post("/api/products", response_model=schemas.ProductOut)
def add_product(prod: schemas.ProductCreate, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Add new product — Owner only."""
    barcode_str = str(prod.barcode or "").strip()
    if not barcode_str:
        barcode_str = crud.generate_barcode(db)
        prod.barcode = barcode_str
    else:
        # Preserve exact string as manually entered (preserves leading zeros)
        prod.barcode = barcode_str
    
    # Check if barcode already exists on any product in DB
    existing = db.query(models.Product).filter(models.Product.barcode == barcode_str).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Barcode '{barcode_str}' already belongs to product '{existing.name}'. Please use a unique barcode."
        )
    return crud.create_product(db, prod)

@app.put("/api/products/{product_id}", response_model=schemas.ProductOut)
def edit_product(product_id: int, prod_update: schemas.ProductUpdate, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Edit product details — Owner only."""
    if prod_update.barcode is not None:
        barcode_clean = str(prod_update.barcode).strip()
        if barcode_clean:
            existing = db.query(models.Product).filter(
                models.Product.barcode == barcode_clean,
                models.Product.id != product_id
            ).first()
            if existing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Barcode '{barcode_clean}' already belongs to product '{existing.name}'. Please use a unique barcode."
                )
            prod_update.barcode = barcode_clean
    
    updated = crud.update_product(db, product_id, prod_update)
    if not updated:
        raise HTTPException(status_code=404, detail="Product not found")
    return updated

@app.delete("/api/products/{product_id}")
def remove_product(product_id: int, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Delete product — Owner only."""
    success = crud.delete_product(db, product_id)
    if not success:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"message": "Product successfully deleted"}

@app.post("/api/products/{product_id}/adjust", response_model=schemas.ProductOut)
def stock_adjustment(product_id: int, payload: dict, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Manual stock adjustment — Owner only."""
    qty_change = float(payload.get("qty_change", 0))
    reason = payload.get("reason", "Manual Adjustment")
    prod = crud.adjust_stock(db, product_id, qty_change, reason)
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    return prod

@app.get("/api/categories")
def list_categories(db: Session = Depends(get_db)):
    cats = db.query(models.Category).all()
    if not cats:
        distinct_cats = db.query(models.Product.category).distinct().all()
        return [{"id": i+1, "name": c[0]} for i, c in enumerate(distinct_cats)]
    return cats

@app.post("/api/pos/hold")
def hold_current_cart(req: schemas.HoldCartRequest, db: Session = Depends(get_db)):
    held = crud.hold_cart(db, req)
    return {"message": "Cart held successfully", "cart_ref": held.cart_ref, "id": held.id}

@app.get("/api/pos/held-carts")
def list_held_carts(db: Session = Depends(get_db)):
    carts = crud.get_held_carts(db)
    return [
        {
            "id": c.id,
            "cart_ref": c.cart_ref,
            "customer_name": c.customer_name,
            "customer_phone": c.customer_phone,
            "notes": c.notes,
            "created_at": c.created_at.strftime("%H:%M:%S"),
            "items_count": len(json.loads(c.items_json))
        }
        for c in carts
    ]

@app.post("/api/pos/recall/{cart_id}")
def recall_cart(cart_id: int, db: Session = Depends(get_db)):
    recalled = crud.recall_held_cart(db, cart_id)
    if not recalled:
        raise HTTPException(status_code=404, detail="Held cart not found")
    return recalled

@app.delete("/api/pos/held-carts/{cart_id}")
def discard_held_cart(cart_id: int, db: Session = Depends(get_db)):
    success = crud.delete_held_cart(db, cart_id)
    if not success:
        raise HTTPException(status_code=404, detail="Cart not found")
    return {"message": "Cart discarded"}

@app.get("/api/orders")
def get_orders_list(limit: int = 50, db: Session = Depends(get_db)):
    orders = db.query(models.Order).order_by(models.Order.created_at.desc()).limit(limit).all()
    return [
        {
            "id": o.id,
            "invoice_number": o.invoice_number,
            "employee_id": o.employee_id,
            "cashier_name": o.cashier_name,
            "customer_name": o.customer_name,
            "customer_phone": o.customer_phone,
            "grand_total": o.grand_total,
            "payment_method": o.payment_method,
            "items_count": len(o.items),
            "created_at": o.created_at.strftime("%Y-%m-%d %I:%M %p")
        }
        for o in orders
    ]

@app.get("/api/orders/{order_id}")
def get_order_receipt(order_id: str, db: Session = Depends(get_db)):
    if order_id.isdigit():
        order = db.query(models.Order).filter(models.Order.id == int(order_id)).first()
    else:
        order = db.query(models.Order).filter(models.Order.invoice_number == order_id).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {
        "id": order.id,
        "invoice_number": order.invoice_number,
        "employee_id": order.employee_id,
        "cashier_name": order.cashier_name,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "register_number": order.register_number,
        "counter_id": getattr(order, "counter_id", "Counter 1") or "Counter 1",
        "subtotal": order.subtotal,
        "tax_amount": order.tax_amount,
        "discount_amount": order.discount_amount,
        "points_redeemed": order.points_redeemed,
        "points_discount": order.points_discount,
        "grand_total": order.grand_total,
        "payment_method": order.payment_method,
        "tendered_amount": getattr(order, "tendered_amount", order.grand_total) or order.grand_total,
        "change_amount": getattr(order, "change_amount", 0.0) or 0.0,
        "payment_details": json.loads(order.payment_details or "{}"),
        "is_reprinted": getattr(order, "is_reprinted", False),
        "reprint_count": getattr(order, "reprint_count", 0),
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
            for i in order.items
        ]
    }


@app.get("/api/customers")
def search_customers(search: Optional[str] = None, db: Session = Depends(get_db)):
    return crud.get_customers(db, search=search)

@app.post("/api/customers")
def register_customer(cust: schemas.CustomerCreate, db: Session = Depends(get_db)):
    existing = crud.get_customer_by_phone(db, cust.phone)
    if existing:
        raise HTTPException(status_code=400, detail="Customer with this phone already exists")
    return crud.create_customer(db, cust)

# ================= SUPPLIERS & PURCHASES ================= #

@app.get("/api/suppliers")
def list_suppliers(db: Session = Depends(get_db)):
    return crud.get_suppliers(db)

@app.get("/api/suppliers/{supplier_id}")
def get_supplier_detail(supplier_id: int, db: Session = Depends(get_db)):
    s = crud.get_supplier(db, supplier_id)
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found")
    data = crud._supplier_to_dict(s)
    data["summary"] = crud.get_supplier_summary(db, supplier_id)
    return data

@app.post("/api/suppliers")
def add_supplier(supp: schemas.SupplierCreate, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Add supplier — Owner only."""
    return crud.create_supplier(db, supp)

@app.put("/api/suppliers/{supplier_id}")
def update_supplier_info(supplier_id: int, supp_update: schemas.SupplierUpdate, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Update supplier — Owner only."""
    updated = crud.update_supplier(db, supplier_id, supp_update)
    if not updated:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return updated

@app.delete("/api/suppliers/{supplier_id}")
def delete_supplier_entry(supplier_id: int, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Delete supplier — Owner only."""
    success = crud.delete_supplier(db, supplier_id)
    if not success:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return {"message": "Supplier deleted successfully"}

@app.get("/api/suppliers/{supplier_id}/purchases")
def get_purchases_for_supplier(supplier_id: int, db: Session = Depends(get_db)):
    return crud.get_supplier_purchases(db, supplier_id)

@app.get("/api/suppliers/{supplier_id}/payments")
def get_payments_for_supplier(supplier_id: int, db: Session = Depends(get_db)):
    return crud.get_supplier_payments(db, supplier_id)

@app.post("/api/supplier-payments")
def record_payment_to_supplier(pay_req: schemas.SupplierPaymentCreate, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Record supplier payment — Owner only."""
    return crud.create_supplier_payment(db, pay_req)


@app.get("/api/purchases")
def list_purchases(db: Session = Depends(get_db)):
    pos = crud.get_purchase_orders(db)
    return [
        {
            "id": p.id,
            "po_number": p.po_number,
            "supplier_id": p.supplier_id,
            "supplier_name": p.supplier.name if p.supplier else "N/A",
            "invoice_number": p.invoice_number,
            "supplier_invoice_number": getattr(p, "supplier_invoice_number", None),
            "purchase_date": getattr(p, "purchase_date", None),
            "total_amount": p.total_amount,
            "paid_amount": getattr(p, "paid_amount", 0.0),
            "due_amount": getattr(p, "due_amount", p.total_amount),
            "tax_amount": p.tax_amount,
            "status": p.status,
            "received_status": getattr(p, "received_status", "PENDING"),
            "payment_status": getattr(p, "payment_status", "PENDING"),
            "created_at": p.created_at.strftime("%Y-%m-%d %H:%M") if p.created_at else None,
            "items_count": len(json.loads(p.items_json or "[]"))
        }
        for p in pos
    ]

@app.get("/api/purchases/{purchase_id}")
def get_single_purchase(purchase_id: int, db: Session = Depends(get_db)):
    po_detail = crud.get_purchase_order_detail(db, purchase_id)
    if not po_detail:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po_detail

@app.post("/api/purchases")
def create_purchase(po_req: schemas.PurchaseOrderCreate, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Create purchase order — Owner only."""
    return crud.create_purchase_order(db, po_req)

@app.post("/api/purchases/{purchase_id}/receive")
def receive_goods_into_stock(purchase_id: int, payload: dict, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Receive goods into stock (GRN) — Owner only."""
    items = payload.get("items") or payload.get("received_items") or []
    notes = payload.get("notes") or ""
    paid_amount = float(payload.get("paid_amount") or 0.0)
    payment_mode = payload.get("payment_mode") or "CASH"
    payment_notes = payload.get("payment_notes")
    received = crud.receive_purchase_order(
        db, 
        purchase_id, 
        items, 
        notes, 
        paid_amount=paid_amount, 
        payment_mode=payment_mode, 
        payment_notes=payment_notes
    )
    if not received:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return {"message": "Goods received successfully and stock updated", "purchase": received, **received}

@app.post("/api/products/generate-barcode")
@app.post("/api/products/{product_id}/generate-barcode")
def get_generated_barcode(product_id: Optional[int] = None, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    """Generate unique product barcode — Owner only."""
    barcode = crud.generate_barcode(db)
    if product_id:
        prod = crud.get_product(db, product_id)
        if prod:
            prod.barcode = barcode
            db.commit()
            db.refresh(prod)
            return {"barcode": barcode, "product_id": prod.id}
    return {"barcode": barcode}

# ================= SALES & PURCHASE RETURNS ================= #

@app.post("/api/sales-returns")
def process_sales_return(req: schemas.SalesReturnCreate, session: dict = Depends(require_authenticated_user), db: Session = Depends(get_db)):
    res = crud.create_sales_return(db, req, user_info=session)
    if not res:
        raise HTTPException(status_code=400, detail="Could not process sales return")
    return res

@app.get("/api/sales-returns")
def list_sales_returns(limit: int = 100, db: Session = Depends(get_db)):
    return crud.get_sales_returns(db, limit=limit)

@app.get("/api/sales-returns/{return_id}")
def get_sales_return_details(return_id: int, db: Session = Depends(get_db)):
    res = crud.get_sales_return_detail(db, return_id)
    if not res:
        raise HTTPException(status_code=404, detail="Sales return record not found")
    return res

@app.post("/api/purchase-returns")
def process_purchase_return(req: schemas.PurchaseReturnCreate, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    return crud.create_purchase_return(db, req, user_info=session)

@app.get("/api/purchase-returns")
def list_purchase_returns(limit: int = 100, db: Session = Depends(get_db)):
    return crud.get_purchase_returns(db, limit=limit)

# ================= STOCK LEDGER & MOVEMENTS ================= #

@app.get("/api/stock-movements")
def list_stock_movements(product_id: Optional[int] = None, movement_type: Optional[str] = None, limit: int = 200, db: Session = Depends(get_db)):
    return crud.get_stock_movements(db, product_id=product_id, movement_type=movement_type, limit=limit)

# ================= BATCH & EXPIRY ================= #

@app.post("/api/batches")
def add_product_batch(req: schemas.ProductBatchCreate, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    batch = crud.create_product_batch(db, req)
    if not batch:
        raise HTTPException(status_code=404, detail="Product not found")
    return batch

@app.get("/api/batches")
def list_product_batches(product_id: Optional[int] = None, db: Session = Depends(get_db)):
    return crud.get_product_batches(db, product_id=product_id)

@app.delete("/api/batches/{batch_id}")
def remove_batch(batch_id: int, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    success = crud.delete_product_batch(db, batch_id)
    if not success:
        raise HTTPException(status_code=404, detail="Batch not found")
    return {"message": "Batch deleted successfully"}

@app.get("/api/expiry-alerts")
def get_expiries(db: Session = Depends(get_db)):
    return crud.get_expiry_alerts(db)

# ================= CASHIER SHIFTS ================= #

@app.post("/api/shifts/open")
def start_cashier_shift(payload: dict, session: dict = Depends(require_authenticated_user), db: Session = Depends(get_db)):
    cashier = payload.get("cashier_name") or session.get("name", "Cashier")
    register = payload.get("register_number", "REG-01")
    cash = float(payload.get("opening_cash", 0.0))
    return crud.open_cashier_shift(db, cashier_name=cashier, register_number=register, opening_cash=cash)

@app.post("/api/shifts/{shift_id}/close")
def end_cashier_shift(shift_id: int, req: schemas.ShiftCloseRequest, db: Session = Depends(get_db)):
    res = crud.close_shift(db, shift_id, req)
    if not res:
        raise HTTPException(status_code=404, detail="Shift not found or already closed")
    return {
        "message": "Shift closed successfully",
        "shift": {
            "id": res.id,
            "cashier_name": res.cashier_name,
            "register_number": res.register_number,
            "opened_at": crud.format_datetime_12h(res.opened_at),
            "closed_at": crud.format_datetime_12h(res.closed_at),
            "opening_cash": res.opening_cash,
            "closing_cash": res.closing_cash,
            "expected_cash": res.expected_cash,
            "actual_cash": res.actual_cash,
            "cash_difference": res.cash_difference,
            "status": res.status,
            "notes": res.notes
        }
    }

@app.get("/api/shifts")
def list_all_shifts(limit: int = 50, db: Session = Depends(get_db)):
    return crud.get_shifts_list(db, limit=limit)

@app.get("/api/shifts/active")
def get_current_shift(cashier_name: Optional[str] = None, db: Session = Depends(get_db)):
    shift = crud.get_active_shift(db, cashier_name=cashier_name)
    if not shift:
        return {"has_active_shift": False}
    return {"has_active_shift": True, "shift": shift, **shift}

# ================= PROMOTIONS & COUPONS ================= #

@app.get("/api/promotions")
def list_promotions(active_only: bool = False, db: Session = Depends(get_db)):
    return crud.get_promotions(db, active_only=active_only)

@app.post("/api/promotions")
def create_new_promotion(req: schemas.PromotionCreate, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    promo = crud.create_promotion(db, req)
    if not promo:
        raise HTTPException(status_code=400, detail=f"Promotion code '{req.code}' already exists")
    return promo

@app.delete("/api/promotions/{promo_id}")
def remove_promotion(promo_id: int, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    success = crud.delete_promotion(db, promo_id)
    if not success:
        raise HTTPException(status_code=404, detail="Promotion not found")
    return {"message": "Promotion deleted successfully"}

@app.post("/api/pos/apply-coupon")
def apply_bill_coupon(req: schemas.ApplyCouponRequest, db: Session = Depends(get_db)):
    return crud.validate_and_apply_coupon(db, coupon_code=req.coupon_code, bill_subtotal=req.bill_subtotal, items=req.items)

# ================= AUDIT LOGS ================= #

@app.get("/api/audit-logs")
def list_audit_logs(action: Optional[str] = None, entity: Optional[str] = None, limit: int = 200, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    return crud.get_audit_logs(db, action=action, entity=entity, limit=limit)

# ================= SMART REORDER ================= #

@app.get("/api/owner/smart-reorder")
def smart_reorder_recommendations(session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    return crud.get_smart_reorder_recommendations(db)

# ================= ADVANCED REPORTS ================= #

@app.get("/api/reports")
def get_reports(report_type: str = "sales_summary", start_date: Optional[str] = None, end_date: Optional[str] = None, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    return crud.get_advanced_reports(db, report_type=report_type, start_date=start_date, end_date=end_date)

# ================= DATABASE BACKUP & RECOVERY ================= #

@app.post("/api/owner/backup")
def take_database_backup(session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    return crud.create_database_backup(db)

@app.get("/api/owner/backups")
def list_backups(session: dict = Depends(require_owner_role)):
    return crud.list_database_backups()

@app.post("/api/owner/restore-backup")
def restore_backup_snapshot(req: schemas.RestoreBackupRequest, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    if not req.confirm:
        raise HTTPException(status_code=400, detail="Restore confirmation required.")
    return crud.restore_database_backup(req.filename, db=db)

# ================= AI BUSINESS ASSISTANT ================= #

@app.post("/api/owner/ai-assistant")
def query_ai_assistant(req: schemas.AiQueryRequest, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    return crud.ask_ai_business_assistant(db, req.query)

# ================= BILL REPRINT ================= #

@app.post("/api/orders/{order_id}/reprint")
def reprint_receipt(order_id: str, db: Session = Depends(get_db)):
    res = crud.reprint_order(db, order_id)
    if not res:
        raise HTTPException(status_code=404, detail="Order not found for reprint")
    return res

@app.get("/api/orders/reprint-last")
def reprint_latest_bill(session: dict = Depends(require_authenticated_user), db: Session = Depends(get_db)):
    emp_id = session.get("employee_id")
    query = db.query(models.Order)
    if emp_id:
        query = query.filter(models.Order.employee_id == emp_id)
    last_order = query.order_by(models.Order.created_at.desc()).first()
    if not last_order:
        raise HTTPException(status_code=404, detail="No previous bills found")
    return crud.reprint_order(db, str(last_order.id))

# ================= SYSTEM HEALTH ================= #

@app.get("/api/system/health")
def system_health_status(db: Session = Depends(get_db)):
    db_connected = True
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
    except Exception:
        db_connected = False
    
    backups = crud.list_database_backups()
    last_backup_time = backups[0]["created_at"] if backups else "Never"
    
    return {
        "backend": {"status": "ONLINE", "version": "3.5.0", "engine": "FastAPI + Uvicorn"},
        "database": {"status": "CONNECTED" if db_connected else "ERROR", "engine": "SQLite + SQLAlchemy"},
        "last_backup": last_backup_time,
        "backups_count": len(backups),
        "timestamp": datetime.datetime.now(crud.IST_ZONE).strftime("%Y-%m-%d %I:%M:%S %p")
    }

# ================= SETTINGS ================= #

@app.get("/api/settings")
def get_all_settings(db: Session = Depends(get_db)):
    settings = db.query(models.StoreSetting).all()
    return {s.key: s.value for s in settings}

@app.post("/api/settings")
def update_settings(payload: dict, session: dict = Depends(require_owner_role), db: Session = Depends(get_db)):
    for k, v in payload.items():
        s = db.query(models.StoreSetting).filter(models.StoreSetting.key == k).first()
        if s:
            s.value = str(v)
        else:
            db.add(models.StoreSetting(key=k, value=str(v)))
    db.commit()
    return {"message": "Settings updated successfully"}

# Static files and frontend serving
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Supermarket Smart Billing API is Running. Frontend not yet initialized."}
