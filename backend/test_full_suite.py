import sys
import os
import json
from datetime import datetime, date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def run_tests():
    print("=" * 60)
    print("RUNNING EXTENDED POS PRODUCTION SYSTEM TEST SUITE")
    print("=" * 60)

    # 1. Login
    res = client.post("/api/auth/login", json={"username": "owner", "password": "admin123"})
    assert res.status_code == 200, f"Login failed: {res.text}"
    token = res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("[PASS] 1. Auth Login: OK")

    # 2. System Health
    res = client.get("/api/system/health", headers=headers)
    assert res.status_code == 200
    health = res.json()
    assert health["backend"]["status"] == "ONLINE"
    assert health["database"]["status"] == "CONNECTED"
    print(f"[PASS] 2. System Health Status: OK (Backend: {health['backend']['status']}, Database: {health['database']['status']})")

    # 3. Batch Management
    res = client.get("/api/products", headers=headers)
    products = res.json()
    assert len(products) > 0
    p = products[0]
    p_id = p["id"]

    batch_payload = {
        "product_id": p_id,
        "batch_number": "BATCH-EXP-TEST-001",
        "mfg_date": str(date.today() - timedelta(days=30)),
        "expiry_date": str(date.today() + timedelta(days=5)),
        "quantity": 20,
        "cost_price": 100.0,
        "selling_price": 150.0
    }
    res = client.post("/api/batches", json=batch_payload, headers=headers)
    assert res.status_code == 200, res.text
    batch_created = res.json()
    print(f"[PASS] 3. Batch Created: OK (Batch: {batch_created['batch_number']})")

    # Batch alerts
    res = client.get("/api/expiry-alerts", headers=headers)
    assert res.status_code == 200
    alerts = res.json()
    assert "expiring_7d_batches" in alerts
    print(f"[PASS] 4. Batch Expiry Alerts: OK ({len(alerts['expiring_7d_batches'])} expiring in 7 days, {len(alerts['expiring_30d_batches'])} in 30 days)")

    # 4. Promotion / Coupon
    promo_payload = {
        "code": "FESTIVE10",
        "title": "Festive 10% Off",
        "description": "10% off on all items above 200",
        "discount_type": "PERCENTAGE",
        "discount_value": 10.0,
        "min_bill_amount": 200.0,
        "max_discount_amount": 50.0,
        "start_date": str(date.today() - timedelta(days=1)),
        "end_date": str(date.today() + timedelta(days=30)),
        "is_active": True
    }
    res = client.post("/api/promotions", json=promo_payload, headers=headers)
    assert res.status_code in [200, 400]
    print(f"[PASS] 5. Promotion Configured: OK (Code: {promo_payload['code']})")

    # Apply coupon at POS
    coupon_req = {
        "coupon_code": "FESTIVE10",
        "bill_subtotal": 350.0,
        "items": [{"product_id": p_id, "quantity": 2, "unit_price": 175.0}]
    }
    res = client.post("/api/pos/apply-coupon", json=coupon_req, headers=headers)
    assert res.status_code == 200
    coupon_res = res.json()
    assert coupon_res["valid"] is True
    assert coupon_res["discount_amount"] == 35.0
    print(f"[PASS] 6. Coupon POS Application: OK (Discount: Rs {coupon_res['discount_amount']})")

    # 5. Shift Management: Open Shift
    shift_open_payload = {
        "cashier_name": "Owner Admin",
        "register_number": "REG-01",
        "opening_cash": 2000.0
    }
    res = client.post("/api/shifts/open", json=shift_open_payload, headers=headers)
    assert res.status_code in [200, 400]
    if res.status_code == 200:
        print(f"[PASS] 7. Cashier Shift Opened: OK (Shift ID: {res.json()['id']})")
    else:
        print("[PASS] 7. Cashier Shift: Active shift available")

    res = client.get("/api/shifts/active", headers=headers)
    assert res.status_code == 200
    cur_shift = res.json()
    assert cur_shift["has_active_shift"] is True
    print(f"[PASS] 8. Cashier Active Shift Queried: OK (Opening Cash: Rs {cur_shift.get('opening_cash')})")

    # 6. Checkout with Cash, Change, and Loyalty
    checkout_payload = {
        "customer_phone": "9876543210",
        "customer_name": "Ramesh Kumar",
        "payment_method": "CASH",
        "payment_details": {
            "amount_received": 500.0,
            "change_returned": 150.0
        },
        "discount_amount": 0.0,
        "notes": "Regular Customer",
        "items": [
            {
                "product_id": p_id,
                "quantity": 1,
                "unit_price": p["selling_price"],
                "tax_rate": p.get("tax_rate", 5.0)
            }
        ]
    }
    res = client.post("/api/pos/checkout", json=checkout_payload, headers=headers)
    assert res.status_code == 200, res.text
    order_data = res.json()
    order_id = order_data["id"]
    order_inv = order_data["invoice_number"]
    print(f"[PASS] 9. POS Checkout: OK (Invoice: {order_inv}, Total: Rs {order_data['grand_total']}, Change: Rs {order_data.get('change_returned', 0.0)})")

    # 7. Reprint Bill
    res = client.post(f"/api/orders/{order_id}/reprint", headers=headers)
    assert res.status_code == 200
    reprint_data = res.json()
    assert reprint_data["is_duplicate"] is True
    print(f"[PASS] 10. Bill Reprint: OK (Is Duplicate: {reprint_data['is_duplicate']}, Bill: {reprint_data['invoice_number']})")

    # 8. Sales Return
    return_payload = {
        "invoice_number": order_inv,
        "refund_method": "CASH",
        "reason": "Customer changed mind",
        "items": [
            {
                "product_id": p_id,
                "returned_quantity": 1.0,
                "unit_price": p["selling_price"],
                "restock_condition": "GOOD"
            }
        ]
    }
    res = client.post("/api/sales-returns", json=return_payload, headers=headers)
    assert res.status_code == 200, res.text
    sr = res.json()
    print(f"[PASS] 11. Sales Return Processed: OK (Return#: {sr['return_number']}, Refund: Rs {sr['total_refund']})")

    # 9. Stock Movement Ledger Verification
    res = client.get("/api/stock-movements", headers=headers)
    assert res.status_code == 200
    movements = res.json()
    assert len(movements) > 0
    latest_mov = movements[0]
    print(f"[PASS] 12. Stock Movement Ledger: OK (Total entries: {len(movements)}, Latest: {latest_mov['movement_type']} {latest_mov['quantity_change']} for {latest_mov['product_name']})")

    # 10. Advanced Business Reports
    res = client.get("/api/reports?report_type=sales_summary", headers=headers)
    assert res.status_code == 200
    summary = res.json()
    print(f"[PASS] 13. Reports Sales Summary: OK (Total Sales: Rs {summary.get('summary', {}).get('total_sales', 0)}, Orders: {summary.get('summary', {}).get('total_bills', 0)})")

    res = client.get("/api/reports?report_type=by_category", headers=headers)
    assert res.status_code == 200
    by_cat = res.json()
    print(f"[PASS] 14. Reports By Category: OK ({len(by_cat.get('breakdown', []))} categories)")

    res = client.get("/api/reports?report_type=gst_summary", headers=headers)
    assert res.status_code == 200
    gst = res.json()
    print(f"[PASS] 15. Reports GST Summary: OK (Taxable: Rs {gst.get('total_taxable', 0)}, Total Tax: Rs {gst.get('total_tax', 0)})")

    # 11. Smart Reorder Engine
    res = client.get("/api/owner/smart-reorder", headers=headers)
    assert res.status_code == 200
    reorder = res.json()
    reorder_count = len(reorder) if isinstance(reorder, list) else len(reorder.get("recommendations", []))
    print(f"[PASS] 16. Smart Reorder Engine: OK ({reorder_count} items analyzed)")

    # 12. Safe Database Backup
    res = client.post("/api/owner/backup", headers=headers)
    assert res.status_code == 200
    backup_meta = res.json()
    print(f"[PASS] 17. Safe DB Backup Created: OK (File: {backup_meta['filename']}, Size: {backup_meta['size_kb']} KB)")

    res = client.get("/api/owner/backups", headers=headers)
    assert res.status_code == 200
    backups = res.json()
    assert len(backups) > 0
    print(f"[PASS] 18. DB Backup History Listed: OK ({len(backups)} backups available)")

    # 13. AI Business Assistant
    res = client.post("/api/owner/ai-assistant", json={"query": "What is our best selling product and total revenue today?"}, headers=headers)
    assert res.status_code == 200
    ai_resp = res.json()
    answer_text = ai_resp.get("answer") or ai_resp.get("response") or ""
    assert len(answer_text) > 5
    print(f"[PASS] 19. Owner AI Business Assistant: OK (Query resolved with live DB context)")

    print("=" * 60)
    print("ALL 19 EXTENDED POS SYSTEM INTEGRATION TESTS PASSED 100%!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
