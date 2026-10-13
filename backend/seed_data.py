import datetime
from sqlalchemy.orm import Session
from . import models
from .database import Base, engine, SessionLocal
from .auth import hash_password

SAMPLE_WORK_SHIFTS = [
    {"name": "Morning Shift", "start_time": "08:00", "end_time": "16:00", "description": "Standard Morning Retail Shift (8:00 AM - 4:00 PM)", "is_active": True},
    {"name": "Evening Shift", "start_time": "16:00", "end_time": "00:00", "description": "Evening Rush & Peak Hours Shift (4:00 PM - 12:00 AM)", "is_active": True},
    {"name": "Night Shift", "start_time": "00:00", "end_time": "08:00", "description": "Night Inventory & Express Lane Shift (12:00 AM - 8:00 AM)", "is_active": True}
]

SAMPLE_CATEGORIES = [
    {"name": "Dairy & Eggs", "icon": "milk", "color": "blue"},
    {"name": "Snacks & Munchies", "icon": "cookie", "color": "amber"},
    {"name": "Beverages & Drinks", "icon": "cup-soda", "color": "cyan"},
    {"name": "Staples & Grains", "icon": "wheat", "color": "yellow"},
    {"name": "Fresh Produce", "icon": "apple", "color": "emerald"},
    {"name": "Personal Care", "icon": "sparkles", "color": "purple"},
    {"name": "Household & Cleaning", "icon": "spray-can", "color": "indigo"},
    {"name": "Bakery & Breads", "icon": "croissant", "color": "orange"}
]

SAMPLE_PRODUCTS = [
    {"barcode": "8901262010011", "sku": "DAI-001", "name": "Amul Taaza Homogenised Toned Milk 1L", "category": "Dairy & Eggs", "brand": "Amul", "unit": "pack", "cost_price": 64.0, "selling_price": 72.0, "mrp": 75.0, "tax_rate": 0.0, "stock_qty": 45, "min_stock": 15, "rack_location": "CHILL-01"},
    {"barcode": "8901262020027", "sku": "DAI-002", "name": "Amul Butter Pasteurized 500g", "category": "Dairy & Eggs", "brand": "Amul", "unit": "pack", "cost_price": 245.0, "selling_price": 275.0, "mrp": 285.0, "tax_rate": 12.0, "stock_qty": 30, "min_stock": 10, "rack_location": "CHILL-02"},
    {"barcode": "8901262030033", "sku": "DAI-003", "name": "Amul Cheese Slices 200g (10 Slices)", "category": "Dairy & Eggs", "brand": "Amul", "unit": "pack", "cost_price": 125.0, "selling_price": 145.0, "mrp": 155.0, "tax_rate": 12.0, "stock_qty": 22, "min_stock": 8, "rack_location": "CHILL-02"},
    {"barcode": "8901262040049", "sku": "DAI-004", "name": "Mother Dairy Classic Curd 400g", "category": "Dairy & Eggs", "brand": "Mother Dairy", "unit": "cup", "cost_price": 32.0, "selling_price": 40.0, "mrp": 42.0, "tax_rate": 0.0, "stock_qty": 18, "min_stock": 12, "rack_location": "CHILL-01"},
    {"barcode": "8901262050055", "sku": "DAI-005", "name": "Farm Fresh Brown Eggs (Pack of 6)", "category": "Dairy & Eggs", "brand": "EggZone", "unit": "pack", "cost_price": 55.0, "selling_price": 70.0, "mrp": 78.0, "tax_rate": 0.0, "stock_qty": 40, "min_stock": 10, "rack_location": "RACK-E1"},
    {"barcode": "8901262060061", "sku": "DAI-006", "name": "Epigamia Greek Yogurt Strawberry 120g", "category": "Dairy & Eggs", "brand": "Epigamia", "unit": "cup", "cost_price": 42.0, "selling_price": 55.0, "mrp": 60.0, "tax_rate": 5.0, "stock_qty": 4, "min_stock": 10, "rack_location": "CHILL-03"},
    {"barcode": "8901491101015", "sku": "SNK-001", "name": "Lay's India's Magic Masala Chips 50g", "category": "Snacks & Munchies", "brand": "Lays", "unit": "pack", "cost_price": 16.0, "selling_price": 20.0, "mrp": 20.0, "tax_rate": 12.0, "stock_qty": 85, "min_stock": 25, "rack_location": "AISLE-03"},
    {"barcode": "8901491102029", "sku": "SNK-002", "name": "Kurkure Masala Munch 82g", "category": "Snacks & Munchies", "brand": "Kurkure", "unit": "pack", "cost_price": 16.5, "selling_price": 20.0, "mrp": 20.0, "tax_rate": 12.0, "stock_qty": 65, "min_stock": 20, "rack_location": "AISLE-03"},
    {"barcode": "8901063010018", "sku": "SNK-003", "name": "Britannia Good Day Cashew Cookies 200g", "category": "Snacks & Munchies", "brand": "Britannia", "unit": "pack", "cost_price": 38.0, "selling_price": 45.0, "mrp": 50.0, "tax_rate": 18.0, "stock_qty": 50, "min_stock": 15, "rack_location": "AISLE-04"},
    {"barcode": "8901063020024", "sku": "SNK-004", "name": "Oreo Original Vanilla Creme Biscuit 120g", "category": "Snacks & Munchies", "brand": "Cadbury", "unit": "pack", "cost_price": 30.0, "selling_price": 38.0, "mrp": 40.0, "tax_rate": 18.0, "stock_qty": 42, "min_stock": 15, "rack_location": "AISLE-04"},
    {"barcode": "8901063030030", "sku": "SNK-005", "name": "Haldiram's Bhujia Sev 400g", "category": "Snacks & Munchies", "brand": "Haldiram", "unit": "pack", "cost_price": 98.0, "selling_price": 120.0, "mrp": 130.0, "tax_rate": 12.0, "stock_qty": 35, "min_stock": 12, "rack_location": "AISLE-03"},
    {"barcode": "8901063040046", "sku": "SNK-006", "name": "Doritos Cheese Supreme Nachos 140g", "category": "Snacks & Munchies", "brand": "Doritos", "unit": "pack", "cost_price": 68.0, "selling_price": 85.0, "mrp": 90.0, "tax_rate": 12.0, "stock_qty": 28, "min_stock": 10, "rack_location": "AISLE-03"},
    {"barcode": "8901063050052", "sku": "SNK-007", "name": "Pringles Sour Cream & Onion 107g", "category": "Snacks & Munchies", "brand": "Pringles", "unit": "can", "cost_price": 95.0, "selling_price": 115.0, "mrp": 125.0, "tax_rate": 12.0, "stock_qty": 0, "min_stock": 10, "rack_location": "AISLE-03"},
    {"barcode": "8901764010014", "sku": "BEV-001", "name": "Coca-Cola Zero Sugar Can 300ml", "category": "Beverages & Drinks", "brand": "Coca-Cola", "unit": "can", "cost_price": 32.0, "selling_price": 40.0, "mrp": 40.0, "tax_rate": 28.0, "stock_qty": 70, "min_stock": 20, "rack_location": "COOL-01"},
    {"barcode": "8901764020020", "sku": "BEV-002", "name": "Thums Up Soft Drink Bottle 750ml", "category": "Beverages & Drinks", "brand": "Thums Up", "unit": "bottle", "cost_price": 36.0, "selling_price": 45.0, "mrp": 45.0, "tax_rate": 28.0, "stock_qty": 55, "min_stock": 15, "rack_location": "COOL-01"},
    {"barcode": "8901764030036", "sku": "BEV-003", "name": "Red Bull Energy Drink 250ml", "category": "Beverages & Drinks", "brand": "Red Bull", "unit": "can", "cost_price": 105.0, "selling_price": 125.0, "mrp": 130.0, "tax_rate": 28.0, "stock_qty": 30, "min_stock": 10, "rack_location": "COOL-02"},
    {"barcode": "8901030010012", "sku": "STP-001", "name": "Aashirvaad Shudh Chakki Atta 5kg", "category": "Staples & Grains", "brand": "Aashirvaad", "unit": "bag", "cost_price": 230.0, "selling_price": 275.0, "mrp": 295.0, "tax_rate": 5.0, "stock_qty": 40, "min_stock": 15, "rack_location": "AISLE-01"},
    {"barcode": "8901030020028", "sku": "STP-002", "name": "Daawat Rozana Super Basmati Rice 5kg", "category": "Staples & Grains", "brand": "Daawat", "unit": "bag", "cost_price": 380.0, "selling_price": 450.0, "mrp": 490.0, "tax_rate": 5.0, "stock_qty": 32, "min_stock": 10, "rack_location": "AISLE-01"},
    {"barcode": "8901030030034", "sku": "STP-003", "name": "Tata Sampann Unpolished Toor Dal 1kg", "category": "Staples & Grains", "brand": "Tata Sampann", "unit": "pack", "cost_price": 145.0, "selling_price": 175.0, "mrp": 190.0, "tax_rate": 0.0, "stock_qty": 25, "min_stock": 10, "rack_location": "AISLE-02"},
    {"barcode": "8901030040040", "sku": "STP-004", "name": "Fortune Sunlite Refined Sunflower Oil 1L", "category": "Staples & Grains", "brand": "Fortune", "unit": "pouch", "cost_price": 135.0, "selling_price": 155.0, "mrp": 168.0, "tax_rate": 5.0, "stock_qty": 50, "min_stock": 15, "rack_location": "AISLE-02"},
    {"barcode": "2000000010015", "sku": "VEG-001", "name": "Fresh Farm Potato (Aloo) 1kg", "category": "Fresh Produce", "brand": "Farm Direct", "unit": "kg", "cost_price": 22.0, "selling_price": 32.0, "mrp": 35.0, "tax_rate": 0.0, "stock_qty": 120.0, "min_stock": 30.0, "rack_location": "VEG-01"},
    {"barcode": "2000000020021", "sku": "VEG-002", "name": "Fresh Red Onion (Pyaz) 1kg", "category": "Fresh Produce", "brand": "Farm Direct", "unit": "kg", "cost_price": 28.0, "selling_price": 42.0, "mrp": 45.0, "tax_rate": 0.0, "stock_qty": 95.0, "min_stock": 25.0, "rack_location": "VEG-01"},
    {"barcode": "2000000060065", "sku": "VEG-006", "name": "Fresh Capsicum Green 500g", "category": "Fresh Produce", "brand": "Farm Direct", "unit": "pack", "cost_price": 24.0, "selling_price": 35.0, "mrp": 40.0, "tax_rate": 0.0, "stock_qty": 2.0, "min_stock": 8.0, "rack_location": "VEG-02"},
    {"barcode": "8901030510017", "sku": "PER-001", "name": "Colgate Strong Teeth Toothpaste 300g", "category": "Personal Care", "brand": "Colgate", "unit": "pack", "cost_price": 135.0, "selling_price": 165.0, "mrp": 180.0, "tax_rate": 18.0, "stock_qty": 45, "min_stock": 15, "rack_location": "AISLE-06"}
]

SAMPLE_CUSTOMERS = [
    {"name": "Aditya Sharma", "phone": "9876543210", "email": "aditya.sharma@example.com", "loyalty_points": 340, "tier": "Gold", "total_spent": 34500.0, "visits_count": 18},
    {"name": "Priya Rajesh", "phone": "9812345678", "email": "priya.r@example.com", "loyalty_points": 580, "tier": "Platinum", "total_spent": 58200.0, "visits_count": 29},
    {"name": "Rahul Verma", "phone": "9765432109", "email": "rahul.v@example.com", "loyalty_points": 110, "tier": "Silver", "total_spent": 11200.0, "visits_count": 7}
]

SAMPLE_SETTINGS = [
    {"key": "store_name", "value": "METRO FRESH SMART MART"},
    {"key": "store_tagline", "value": "Premium Supermarket & Gourmet Groceries"},
    {"key": "store_address", "value": "Shop 12-16, City Centre Mall, Commercial Hub"},
    {"key": "store_phone", "value": "+91 98765 00112 / 022-28991200"},
    {"key": "store_email", "value": "support@metrofreshpos.com"},
    {"key": "store_gstin", "value": "27AABCM9988D1Z2"},
    {"key": "store_fssai", "value": "11521008000492"},
    {"key": "receipt_header", "value": "THANK YOU FOR SHOPPING WITH US!"},
    {"key": "receipt_footer", "value": "Goods once sold can be exchanged within 7 days with original invoice.\nThank You, Visit Again!"},
    {"key": "currency_symbol", "value": "₹"},
    {"key": "upi_id", "value": "metrofresh@icici"}
]

def seed_database(db: Session = None):
    auto_close = False
    if db is None:
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        auto_close = True

    try:
        # 1. Seed Work Shifts
        if db.query(models.WorkShift).count() == 0:
            print("[SEED] Seeding Work Shifts...")
            for s_data in SAMPLE_WORK_SHIFTS:
                db.add(models.WorkShift(**s_data))
            db.commit()

        # 2. Seed Users (Owner and Cashiers)
        if db.query(models.User).count() == 0:
            print("[SEED] Seeding Owner and Employee Accounts...")
            shifts = db.query(models.WorkShift).all()
            morning_shift_id = shifts[0].id if len(shifts) > 0 else None
            evening_shift_id = shifts[1].id if len(shifts) > 1 else None

            # Owner Account (Username: owner / Password: password123)
            owner_user = models.User(
                employee_id="OWNER01",
                name="Store Owner (Administrator)",
                username="owner",
                phone="9876500001",
                email="owner@metrofreshmart.com",
                hashed_password=hash_password("admin123"),
                role="OWNER",
                salary_type="MONTHLY",
                salary_rate=0.0,
                status="ACTIVE",
                joining_date="2025-01-01"
            )
            db.add(owner_user)

            # Employee 1: Ravi Kumar (Morning Shift Cashier)
            emp1 = models.User(
                employee_id="EMP001",
                name="Ravi Kumar",
                username="EMP001",
                phone="9876500111",
                email="ravi.kumar@metrofreshmart.com",
                hashed_password=hash_password("password123"),
                role="EMPLOYEE",
                salary_type="MONTHLY",
                salary_rate=18000.0,
                assigned_shift_id=morning_shift_id,
                status="ACTIVE",
                joining_date="2025-06-01"
            )
            db.add(emp1)

            # Employee 2: Kumar Sundaram (Evening Shift Cashier)
            emp2 = models.User(
                employee_id="EMP002",
                name="Kumar Sundaram",
                username="EMP002",
                phone="9876500222",
                email="kumar.s@metrofreshmart.com",
                hashed_password=hash_password("password123"),
                role="EMPLOYEE",
                salary_type="MONTHLY",
                salary_rate=18000.0,
                assigned_shift_id=evening_shift_id,
                status="ACTIVE",
                joining_date="2025-08-15"
            )
            db.add(emp2)

            # Employee 3: Priya Sharma (Morning Shift Cashier)
            emp3 = models.User(
                employee_id="EMP003",
                name="Priya Sharma",
                username="EMP003",
                phone="9876500333",
                email="priya.sharma@metrofreshmart.com",
                hashed_password=hash_password("password123"),
                role="EMPLOYEE",
                salary_type="MONTHLY",
                salary_rate=19500.0,
                assigned_shift_id=morning_shift_id,
                status="ACTIVE",
                joining_date="2025-09-01"
            )
            db.add(emp3)
            db.commit()

            # Seed an active check-in for EMP001 (Ravi Kumar)
            today_str = datetime.date.today().strftime("%Y-%m-%d")
            check_in_time = datetime.datetime.utcnow() - datetime.timedelta(hours=3, minutes=15)
            active_att = models.Attendance(
                employee_id=emp1.id,
                employee_code=emp1.employee_id,
                employee_name=emp1.name,
                shift_id=morning_shift_id,
                shift_name="Morning Shift",
                date=today_str,
                check_in_time=check_in_time,
                status="WORKING",
                late_minutes=2,
                bills_count=2,
                total_sales=2080.4,
                cash_sales=912.0,
                upi_sales=1168.4,
                card_sales=0.0,
                items_sold=6,
                notes="Checked in on time."
            )
            db.add(active_att)
            db.commit()

        # 3. Seed Categories
        if db.query(models.Category).count() == 0:
            print("[SEED] Seeding Categories...")
            for cat_data in SAMPLE_CATEGORIES:
                db.add(models.Category(**cat_data))
            db.commit()

        # 4. Seed Products
        if db.query(models.Product).count() == 0:
            print("[SEED] Seeding Products...")
            for prod_data in SAMPLE_PRODUCTS:
                db.add(models.Product(**prod_data))
            db.commit()

        # 5. Seed Customers
        if db.query(models.Customer).count() == 0:
            print("[SEED] Seeding Customers...")
            for cust_data in SAMPLE_CUSTOMERS:
                db.add(models.Customer(**cust_data))
            db.commit()

        # 6. Seed Settings
        if db.query(models.StoreSetting).count() == 0:
            print("[SEED] Seeding Store Settings...")
            for set_data in SAMPLE_SETTINGS:
                db.add(models.StoreSetting(**set_data))
            db.commit()

        # 7. Seed sample orders with employee linkage if orders empty
        if db.query(models.Order).count() == 0:
            print("[SEED] Seeding initial employee-linked orders...")
            prods = db.query(models.Product).all()
            emp1 = db.query(models.User).filter(models.User.employee_id == "EMP001").first()
            if len(prods) >= 3 and emp1:
                o1 = models.Order(
                    invoice_number="INV-20261006-0001",
                    customer_name="Priya Rajesh",
                    customer_phone="9812345678",
                    employee_id=emp1.employee_id,
                    cashier_name=emp1.name,
                    register_number="POS-01 (Express Lane)",
                    subtotal=1120.0,
                    tax_amount=98.4,
                    discount_amount=50.0,
                    grand_total=1168.4,
                    payment_method="UPI",
                    payment_details='{"upi_ref": "UPI889201992", "method": "GooglePay"}',
                    status="COMPLETED",
                    created_at=datetime.datetime.utcnow() - datetime.timedelta(hours=2, minutes=30)
                )
                db.add(o1)
                db.flush()
                db.add(models.OrderItem(order_id=o1.id, product_id=prods[0].id, product_name=prods[0].name, barcode=prods[0].barcode, quantity=2, unit="pack", unit_price=prods[0].selling_price, cost_price=prods[0].cost_price, tax_rate=prods[0].tax_rate, tax_amount=0, discount_amount=0, total_price=144.0))
                db.add(models.OrderItem(order_id=o1.id, product_id=prods[1].id, product_name=prods[1].name, barcode=prods[1].barcode, quantity=1, unit="pack", unit_price=prods[1].selling_price, cost_price=prods[1].cost_price, tax_rate=prods[1].tax_rate, tax_amount=33.0, discount_amount=0, total_price=308.0))

                o2 = models.Order(
                    invoice_number="INV-20261006-0002",
                    customer_name="Aditya Sharma",
                    customer_phone="9876543210",
                    employee_id=emp1.employee_id,
                    cashier_name=emp1.name,
                    register_number="POS-01 (Express Lane)",
                    subtotal=840.0,
                    tax_amount=72.0,
                    discount_amount=0.0,
                    grand_total=912.0,
                    payment_method="CASH",
                    payment_details='{"cash_tendered": 1000.0, "change_returned": 88.0}',
                    status="COMPLETED",
                    created_at=datetime.datetime.utcnow() - datetime.timedelta(hours=1, minutes=15)
                )
                db.add(o2)
                db.flush()
                db.add(models.OrderItem(order_id=o2.id, product_id=prods[6].id, product_name=prods[6].name, barcode=prods[6].barcode, quantity=2, unit="pack", unit_price=prods[6].selling_price, cost_price=prods[6].cost_price, tax_rate=prods[6].tax_rate, tax_amount=4.8, discount_amount=0, total_price=40.0))
                db.commit()

        print("[SEED] Database seeding complete!")
    finally:
        if auto_close:
            db.close()

if __name__ == "__main__":
    seed_database()
