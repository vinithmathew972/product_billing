import sys
import os
from fastapi.testclient import TestClient

# Ensure root directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app

def run_all_tests():
    client = TestClient(app)
    print("========================================")
    print("STARTING SUPERMARKET SYSTEM INTEGRATION TESTS")
    print("========================================")

    # 1. Health check
    res = client.get("/api/health")
    assert res.status_code == 200, f"Health check failed: {res.text}"
    print("[PASS] 1. Health check: OK")

    # 2. Login as Owner
    res = client.post("/api/auth/login", json={"username": "owner", "password": "admin123"})
    assert res.status_code == 200, f"Owner login failed: {res.text}"
    owner_token = res.json()["token"]
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    print("[PASS] 2. Owner Authentication: OK")

    # 3. Barcode Generation
    res = client.post("/api/products/generate-barcode", headers=owner_headers)
    assert res.status_code == 200, f"Barcode generation failed: {res.text}"
    gen_barcode = res.json()["barcode"]
    assert len(gen_barcode) == 13, f"Invalid barcode length: {gen_barcode}"
    print(f"[PASS] 3. Barcode Generation ({gen_barcode}): OK")

    # 4. Supplier Management
    res = client.post("/api/suppliers", json={
        "name": "Metro Wholesale & FMCG",
        "contact_person": "Suresh Raina",
        "phone": "9840112233",
        "email": "metro@fmcgwholesalers.in",
        "gstin": "33AABCM5555P1Z9",
        "address": "45 Industrial Corridor, Guindy, Chennai"
    }, headers=owner_headers)
    assert res.status_code == 200, f"Supplier creation failed: {res.text}"
    supplier = res.json()
    supplier_id = supplier["id"]
    print(f"[PASS] 4. Supplier Creation (ID: {supplier_id}, Name: {supplier['name']}): OK")

    # 5. Retrieve Products & Ensure Cost Price
    res = client.get("/api/products", headers=owner_headers)
    assert res.status_code == 200, f"Product list failed: {res.text}"
    products = res.json()
    assert len(products) > 0, "No products found in catalog"
    target_product = products[0]
    prod_id = target_product["id"]
    initial_stock = target_product["stock_qty"]
    cost_price = target_product.get("cost_price", 25.0) or 25.0
    print(f"[PASS] 5. Product Catalog: OK ({len(products)} products, Target: {target_product['name']}, Initial Stock: {initial_stock})")

    # 6. Create Purchase Order (PO)
    po_order_qty = 40
    res = client.post("/api/purchases", json={
        "supplier_id": supplier_id,
        "notes": "Weekly Restock Order #2026",
        "items": [
            {
                "product_id": prod_id,
                "ordered_quantity": po_order_qty,
                "cost_price": cost_price,
                "tax_percent": 5.0
            }
        ]
    }, headers=owner_headers)
    assert res.status_code == 200, f"Purchase Order creation failed: {res.text}"
    po = res.json()
    po_id = po["id"]
    print(f"[PASS] 6. Purchase Order Created (PO#: {po['po_number']}, Amount: Rs {po['total_amount']}): OK")

    # 7. Check Stock has NOT increased yet before GRN
    res = client.get(f"/api/products/{prod_id}", headers=owner_headers)
    assert res.status_code == 200
    stock_before_grn = res.json()["stock_qty"]
    assert stock_before_grn == initial_stock, f"Stock changed prematurely! Expected {initial_stock}, got {stock_before_grn}"
    print(f"[PASS] 7. Inventory Safety (Stock remained {stock_before_grn} before GRN): OK")

    # 8. Receive Goods (GRN)
    receive_qty = 40
    paid_amt = 500.0
    res = client.post(f"/api/purchases/{po_id}/receive", json={
        "received_items": [
            {
                "product_id": prod_id,
                "received_quantity": receive_qty
            }
        ],
        "paid_amount": paid_amt,
        "payment_mode": "UPI",
        "payment_notes": "Advance via UPI on receipt of goods"
    }, headers=owner_headers)
    assert res.status_code == 200, f"Goods Receiving failed: {res.text}"
    grn_result = res.json()
    print(f"[PASS] 8. Goods Receiving Note (GRN Received: {receive_qty} units, Paid: Rs {paid_amt}, Due: Rs {grn_result.get('due_amount')}): OK")

    # 9. Verify Stock increased strictly after GRN
    res = client.get(f"/api/products/{prod_id}", headers=owner_headers)
    stock_after_grn = res.json()["stock_qty"]
    expected_stock = initial_stock + receive_qty
    assert stock_after_grn == expected_stock, f"Stock did not update! Expected {expected_stock}, got {stock_after_grn}"
    print(f"[PASS] 9. Stock Updated Post-GRN ({initial_stock} -> {stock_after_grn}): OK")

    # 10. Record Additional Supplier Payment
    res = client.post("/api/supplier-payments", json={
        "supplier_id": supplier_id,
        "purchase_order_id": po_id,
        "amount": 200.0,
        "payment_method": "BANK_TRANSFER",
        "payment_date": "2026-10-07",
        "reference_number": "NEFT88997766",
        "notes": "Second installment settlement"
    }, headers=owner_headers)
    assert res.status_code == 200, f"Supplier payment recording failed: {res.text}"
    print(f"[PASS] 10. Supplier Payment Settlement Recorded (Rs 200 via BANK_TRANSFER): OK")

    # 11. POS Checkout & Real-Time Stock Decrement
    sold_qty = 5
    res = client.post("/api/pos/checkout", json={
        "customer_name": "Siddharth Verma",
        "customer_phone": "9887766554",
        "payment_mode": "UPI",
        "discount_amount": 10.0,
        "amount_paid": 500.0,
        "items": [
            {
                "product_id": prod_id,
                "quantity": sold_qty,
                "price": target_product["selling_price"],
                "tax_percent": 5.0
            }
        ]
    }, headers=owner_headers)
    assert res.status_code == 200, f"POS Checkout failed: {res.text}"
    checkout_data = res.json()
    bill_no = checkout_data.get("invoice_number") or checkout_data.get("bill_number")
    print(f"[PASS] 11. POS Checkout Executed (Bill: {bill_no}, Items: {sold_qty} pcs, Total: Rs {checkout_data.get('grand_total')}): OK")

    # 12. Verify Stock decremented after POS sale
    res = client.get(f"/api/products/{prod_id}", headers=owner_headers)
    stock_after_pos = res.json()["stock_qty"]
    expected_final_stock = expected_stock - sold_qty
    assert stock_after_pos == expected_final_stock, f"Stock after POS checkout mismatch! Expected {expected_final_stock}, got {stock_after_pos}"
    print(f"[PASS] 12. Inventory Decremented via POS Sale ({stock_after_grn} -> {stock_after_pos}): OK")

    # 13. Owner Dashboard Summary & Metrics
    res = client.get("/api/owner/dashboard-metrics", headers=owner_headers)
    assert res.status_code == 200, f"Dashboard metrics failed: {res.text}"
    metrics = res.json()
    print(f"[PASS] 13. Dashboard Metrics (Today's Sales: Rs {metrics['today_sales']}, Bills: {metrics['today_bills']}, Products: {metrics['total_products']}, Low Stock: {metrics['low_stock_count']}, Suppliers: {metrics.get('total_suppliers', 0)}, Profit: Rs {metrics.get('estimated_profit', 0)}): OK")

    print("========================================")
    print("ALL 13 SUPERMARKET INTEGRATION TESTS PASSED 100% SUCCESSFULLY!")
    print("========================================")

if __name__ == "__main__":
    run_all_tests()
