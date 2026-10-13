# Metro Fresh | Supermarket Smart Billing & Inventory Management System

A commercial-grade, enterprise-ready **Retail Supermarket POS & Inventory Management System** built with **FastAPI**, **SQLAlchemy**, **SQLite**, and an ultra-responsive POS frontend designed specifically for supermarket checkout counters, retail stores, and executive inventory auditing.

---

## 🚀 Key Modules & Capabilities

### 1. High-Speed POS Billing Terminal
- **Fast Barcode / SKU / Item Name Search**: Instant keyboard scanner wedge listener (auto-detects hardware laser/CCD barcode gun + Enter).
- **Camera / Mobile Barcode Scanner**: Live webcam/phone camera scanner integrated via ZXing library.
- **Produce & Digital Weight Scale Integration**: Loose items / vegetables / fruits billed on ₹/kg weight basis with live calculation.
- **Cart Management**: Real-time quantity adjustments, discount inputs, item tax breakdown, and fast deletion.
- **Multi-Slab GST Taxation**: Embedded Indian/Global GST tax slabs (0%, 5%, 12%, 18%, 28% CGST/SGST).
- **Audio Feedback**: Cashier scanner beeps, success chimes, and drawer audio feedback via Web Audio API.

### 2. Multi-Payment Split & Settlement
- **Cash**: Smart cash denomination helper (₹500, ₹200, ₹100 notes) with instant change calculation.
- **Dynamic UPI QR Code**: Generates real-time UPI QR codes with exact order amount and store VPA for Google Pay, PhonePe, Paytm, BHIM, Cred.
- **Card (POS)**: Last 4 digits and EDC approval authorization code tracking.
- **Split Payment**: Cash + Card + UPI split tenders on a single invoice.

### 3. Customer Loyalty & Membership Hub
- Tier-based memberships: **Bronze**, **Silver**, **Gold**, **Platinum**.
- Loyalty points earn rate (1 point per ₹100 spent) and 1-click redemption (50 pts = ₹25, 100 pts = ₹50 discount).
- Customer purchase history and lifetime spending ledger.

### 4. Bill Suspend & Hold Engine (F7 / F8)
- Allows cashier to suspend a customer's cart if they forgot an item, serve the next customer, and recall the cart seamlessly with 1 click.

### 5. ESC/POS 80mm / 58mm Thermal Receipt Generator
- Authentic monospaced supermarket thermal receipt format with store details, GSTIN, FSSAI, token number, itemized tax rates, savings statement, and print engine (`window.print()`).

### 6. Product Catalog & Inventory Auditing
- Barcode (EAN-13), SKU, Cost Price, Selling Price, MRP, Tax %, Stock Quantity, Reorder Level, and Rack/Aisle coordinates.
- Low stock warning badges and quick manual stock adjustment modal (+/-).

### 7. Supplier Management & Goods Received Note (GRN)
- Vendor directory with GSTIN and contact details.
- GRN shipment receiving that automatically replenishes stock quantities and updates wholesale cost prices.

### 8. Cashier Shift & Cash Drawer Reconciliation (Z-Report)
- Opening float cash entry.
- Real-time expected drawer balance.
- Petty cash movement logs (Cash In / Cash Out).
- End-of-Day Shift Close with actual counted cash variance computation.

### 9. Executive Analytics Dashboard
- Live Gross Revenue, Gross Profit, Profit Margin (%), Average Basket Value (ABV), SKUs in stock, and Low Stock Alerts.
- Hourly sales trend chart (peak hours detection).
- Category-wise revenue doughnut chart.
- Top 10 fast-moving supermarket items leaderboard.

### 10. Shelf Barcode & Price Tag Studio
- Printable shelf-edge tags (70mm x 35mm) with Code128 / EAN-13 barcodes, MRP, and Our Price tags ready for standard laser/thermal label printers.

---

## ⌨️ Cashier Keyboard Shortcuts Cheat Sheet

| Key | Action |
|---|---|
| `[F2]` | Focus Barcode Scanner Input |
| `[F4]` | Quick Cash Checkout |
| `[F7]` | Hold / Suspend Current Cart |
| `[F8]` | Recall Suspended Bill |
| `[F9]` | Instant UPI QR Code Modal |
| `[F12]` | Open Multi-Payment Checkout |
| `[Esc]` | Close Active Modal / Return to Billing |

---

## 🛠️ How to Run

### Option 1: 1-Click Batch Launcher (Windows)
Double-click `start.bat`.

### Option 2: Command Line
```powershell
python run.py
```
The system will start the backend server at `http://127.0.0.1:8000` and automatically open your default browser.
