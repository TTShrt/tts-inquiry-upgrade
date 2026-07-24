// seed_list_prices.js — one-time import of TTS 2026 List Price into MongoDB.
// ✅ LISTPRICE: creates/updates the `list_prices` collection ONLY. Never touches `inquiries`.
// Usage (Render shell):
//   node seed_list_prices.js            -> DRY RUN: shows what would be written, no DB writes
//   node seed_list_prices.js --write    -> performs the upserts
// Data source: TTS-Quotation (2025).xlsx, with the approved wording corrections applied
// (Oversize, Hand unload, >10 SKU, inbound per Container / LTL per BOL, 40" x 48", etc.)

const PAGES = [
 {
  "pageKey": "drayage",
  "title": "Drayage to TTS Warehouse",
  "category": "Container Drayage",
  "sortOrder": 10,
  "layout": "price",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "Container Drayage - to Total Solution Warehouses",
    "rows": [
     {
      "description": "Houston Container Drayage - From Port to TTS 21DG",
      "price": "380.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Houston Container Drayage - From Port to TTS 21WP",
      "price": "480.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Savannah Container Drayage - From GCT to TTS 31CA",
      "price": "350.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Chicago Container Drayage - From BNSF LPC/UP G4 IV to 41SC",
      "price": "425.00",
      "unit": "Container",
      "minChg": "",
      "notes": "+ CP/NS/CSX $150 Surcharge if container returns to other ramp"
     },
     {
      "description": "Chicago Container Drayage - From CN/NS/CSX Ramp to 41SC",
      "price": "550.00",
      "unit": "Container",
      "minChg": "",
      "notes": "+ CP/NS/CSX $150 Surcharge"
     },
     {
      "description": "Chicago Container Drayage - From CP Ramp to 41SC",
      "price": "650.00",
      "unit": "Container",
      "minChg": "",
      "notes": "+ CP/NS/CSX $150 Surcharge"
     },
     {
      "description": "Los Angeles Container Drayage - From Port to TTS 11EP2",
      "price": "485.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "NYC/NJ Container Drayage - From Port to TTS 51RA",
      "price": "580.00",
      "unit": "Container",
      "minChg": "",
      "notes": "+Toll: NYC $165 GCT NY (Howland Hook/Staten Island) - $260 \nPLNY -(Port Liberty NY) & and Red Hook, NY. - $260"
     },
     {
      "description": "ON Container Drayage - From Ramp to TTS 71WP",
      "price": "Quote",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Chassis Fee",
      "price": "45.00",
      "unit": "Day",
      "minChg": "90.00",
      "notes": "Min 2 days"
     },
     {
      "description": "+ Accessorial charges, if applicable",
      "price": "",
      "unit": "",
      "minChg": "",
      "notes": "see drayage surcharge page"
     }
    ]
   }
  ],
  "pageNote": ""
 },
 {
  "pageKey": "drayage_surcharges",
  "title": "Drayage Surcharges (Accessorial)",
  "category": "Container Drayage",
  "sortOrder": 20,
  "layout": "twocol",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "Container Drayage - Accessorial Charges",
    "rows": [
     {
      "description": "Freight Rate (Inclusive FSC)",
      "price": "See Quotation",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "CHASSIS USAGE",
      "price": "$45.00/day (Min. 2 days); Tri-Axle $125.00/day (Min. 3 days)",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "CHASSIS SPLIT",
      "price": "Minimum $100.00 based on Location/Mileage/Occurence",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Driver Detention at Terminal",
      "price": "$100.00/hour, (1 hour free)",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Driver Waiting Time at Warehouse",
      "price": "$100.00/hour, (1 hour free)",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "PREPULL",
      "price": "Minimum $150.00 based on Location/Mileage",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "YARD STORAGE",
      "price": "$55.00/day",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "OVER WEIGHT LOCAL (up to 48,000lbs)",
      "price": "250.00",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "OVER WEIGHT OUT OF TOWN (up to 48,000lbs)",
      "price": "300.00",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "EXCESSIVE OVER WEIGHT LOCAL(>48000lbs)",
      "price": "TBD",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "EXCESSIVE OVER WEIGHT, OUT OF TOWN (>48000lbs)",
      "price": "TBD",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Weight Ticket",
      "price": "65.00",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "SWING/FLIP",
      "price": "200.00",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "DROP CHARGE",
      "price": "Minimum $125.00 based on mileage.TTS LAX/SAV/CHI/NJ whse: waived.",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "LAYOVER",
      "price": "$400.00 (Usually applies to deliveries past 270 miles one-way)",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "BONDED FEE",
      "price": "175.00",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "RESPOT",
      "price": "55.00",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "EXTRA STOP/PER STOP",
      "price": "Minimum $150.00 based on mileage.",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "DRY RUN",
      "price": "Min $150 base on mileage.",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "REEFER FEE",
      "price": "200.00",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "SCALE SERVICE",
      "price": "55.00",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "RUSH ORDER",
      "price": "150.00",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "ADMIN FEE",
      "price": "Per diem / Demurrage / container repairs....etc \n$35 per payment if customer prepay TTS; or $35 < $500 ;\n$50 for $500-$1000\n$150 for $1000 - $2000\n10% of the total payment $2000-$5000",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "AMAZON SURCHARGES",
      "price": "100.00",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "TERMINAL SURCHARGE",
      "price": "Per quotation",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "LOS ANGELES PORT PIER PASS",
      "price": "$55/20', $98/40' (12/31/2026)",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "LOS ANGELES PORT CLEANING TRUCK FEE",
      "price": "$15/20'; $25/40'",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "OAKLAND PORT GATE FEE & CHASSIS IN",
      "price": "GATE FEE $60/CONTAINER. UPDATE EFFECTIVE 07/01/2025 PER OICT",
      "unit": "",
      "minChg": "",
      "notes": ""
     }
    ]
   }
  ],
  "pageNote": ""
 },
 {
  "pageKey": "import_service",
  "title": "Import Service",
  "category": "Import Service",
  "sortOrder": 30,
  "layout": "price",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "Customs Clearance",
    "rows": [
     {
      "description": "ISF Filing",
      "price": "25.00",
      "unit": "BOL",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Customs Entry",
      "price": "85.00",
      "unit": "BOL",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Additional Line",
      "price": "6.00",
      "unit": "Line",
      "minChg": "",
      "notes": "2 lines free"
     },
     {
      "description": "Remote Filing",
      "price": "15.00",
      "unit": "BOL",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Duty",
      "price": "n/a",
      "unit": "",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Importer ID Application",
      "price": "65.00",
      "unit": "ID",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Purchase Single Bond",
      "price": "90.00",
      "unit": "BOL",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Purchase Annual Bond",
      "price": "400.00",
      "unit": "ID",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Import Release & Handling",
    "rows": [
     {
      "description": "Ocean Import Handling Fee (Release only)",
      "price": "85.00",
      "unit": "BOL",
      "minChg": "",
      "notes": "Drayage arranged by customer"
     },
     {
      "description": "Ocean Import Handling Fee (with TTS Drayage Service)",
      "price": "65.00",
      "unit": "BOL",
      "minChg": "",
      "notes": "Drayage arranged by TTS"
     },
     {
      "description": "Air Import Handling Fee (Release only)",
      "price": "85.00",
      "unit": "AWB",
      "minChg": "",
      "notes": "Airport Pickup arranged by customer"
     },
     {
      "description": "Air Import Handling Fee (with TTS trucking service)",
      "price": "65.00",
      "unit": "AWB",
      "minChg": "",
      "notes": "Airport pickup arranged by TTS"
     },
     {
      "description": "CFS Handling Fee",
      "price": "65.00",
      "unit": "BOL",
      "minChg": "",
      "notes": "Applies to CFS cargo release and pickup coordination."
     }
    ]
   },
   {
    "heading": "Other Service",
    "rows": [
     {
      "description": "IOR",
      "price": "n/a",
      "unit": "",
      "minChg": "",
      "notes": "quote if needed"
     },
     {
      "description": "Import Agent",
      "price": "n/a",
      "unit": "",
      "minChg": "",
      "notes": "quote if needed"
     },
     {
      "description": "Disbursement & Advance Payment Fee",
      "price": "35 +8% of advanced amount",
      "unit": "BOL",
      "minChg": "",
      "notes": "Applies to third-party charges advanced on behalf of the customer."
     }
    ]
   }
  ],
  "pageNote": ""
 },
 {
  "pageKey": "tl_fcl_p2p",
  "title": "FCL-Pallet to Pallet",
  "category": "Transload (Cross Dock)",
  "sortOrder": 40,
  "layout": "price",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "● Palletized",
    "rows": []
   },
   {
    "heading": "○ FCL / FTL (Pallet to Pallet transload)",
    "rows": [
     {
      "description": "Order Processing Fee",
      "price": "25.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Cargo Transload - Pallet to Pallet",
    "rows": [
     {
      "description": "Palletized Cargo Transload per 20' without sorting",
      "price": "400.00",
      "unit": "20'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Palletized Cargo Transload per 40' without sorting",
      "price": "500.00",
      "unit": "40' / 40'HQ",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Palletized Cargo Transload per 4HQ' without sorting",
      "price": "600.00",
      "unit": "45'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Palletized Cargo Transload per 53' without sorting",
      "price": "600.00",
      "unit": "53'",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Surcharges（if applicable, for transload within 30 days only）",
    "rows": [
     {
      "description": "+ Oversize / overweight handling fee",
      "price": "150.00",
      "unit": "20'",
      "minChg": "",
      "notes": "Please find below"
     },
     {
      "description": "+ Oversize / overweight handling fee",
      "price": "250.00",
      "unit": "40'",
      "minChg": "",
      "notes": "Please find below"
     },
     {
      "description": "+ Pallet/ Crate repair service",
      "price": "",
      "unit": "",
      "minChg": "",
      "notes": "Quote by case"
     },
     {
      "description": "Storage 0-3 days per pallet (standard 40\" x 48\" pallet)",
      "price": "Free",
      "unit": "Pallet",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Storage per pallet per week after 3 days (standard stackable pallet)",
      "price": "5.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$8/pallet for CA & NJ"
     },
     {
      "description": "Storage per container per week after 3 days",
      "price": "100.00",
      "unit": "20' container",
      "minChg": "",
      "notes": "$150/container for CA & NJ"
     },
     {
      "description": "Storage per container per week after 3 days",
      "price": "150.00",
      "unit": "40' container",
      "minChg": "",
      "notes": "$250/container for CA & NJ"
     }
    ]
   }
  ],
  "pageNote": "OD / OW DEFINITION – PALLET / CRATE / BUNDLE:\n\nOW HANDLING FEES VARY DEPENDING ON THE DEGREE OF OVERWEIGHT, CARGO STABILITY, AND ACTUAL HANDLING COMPLEXITY.\n\nWEIGHT LIMIT:\nANY PALLET / BUNDLE / CRATE WEIGHING MORE THAN 8,000 POUNDS (LBS) IS SUBJECT TO ADDITIONAL HANDLING FEES.\n\nSIZE LIMIT:\nANY PALLET / CRATE / BUNDLE EXCEEDING 120 INCHES IN LENGTH, OR REQUIRING SPECIAL HANDLING DUE TO DIMENSIONS OR SHAPE, WILL BE CONSIDERED OVERSIZED AND SUBJECT TO ADDITIONAL HANDLING FEES.\n\nEXTREME OW / OD:\nCARGO WEIGHING MORE THAN 12,000 LBS OR EXCEEDING 288 INCHES IN LENGTH WILL BE CONSIDERED EXTREME OW / OD\nAND WILL BE SUBJECT TO ADDITIONAL CHARGES BASED ON ACTUAL OPERATING REQUIREMENTS."
 },
 {
  "pageKey": "tl_ltl_p2p",
  "title": "LTL-Pallet to Pallet",
  "category": "Transload (Cross Dock)",
  "sortOrder": 50,
  "layout": "price",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "● Palletized",
    "rows": []
   },
   {
    "heading": "○ LTL （Pallet to Pallet transload）",
    "rows": [
     {
      "description": "Order Processing Fee",
      "price": "15.00",
      "unit": "BOL",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Cargo Transload - Pallet to Pallet",
    "rows": [
     {
      "description": "Pallet In",
      "price": "10.00",
      "unit": "Pallet/Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Pallet Out",
      "price": "10.00",
      "unit": "Pallet/Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ OD or OW handling fee",
      "price": "$10-$50",
      "unit": "Pallet/Unit",
      "minChg": "",
      "notes": "Please find below"
     },
     {
      "description": "+ Excessive OW handling fee",
      "price": "Quote",
      "unit": "Pallet/Unit",
      "minChg": "",
      "notes": "Please find below"
     },
     {
      "description": "Storage 0-3 days per standard pallet (standard 40\" x 48\" pallet)",
      "price": "Free",
      "unit": "Pallet",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Storage per standard pallet per week after 3 days (stackable)",
      "price": "5.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$8/pallet for CA & NJ"
     }
    ]
   }
  ],
  "pageNote": "OD / OW DEFINITION – PALLET / CRATE / BUNDLE:\n\nOW HANDLING FEES VARY DEPENDING ON THE DEGREE OF OVERWEIGHT, CARGO STABILITY, AND ACTUAL HANDLING COMPLEXITY.\n\nWEIGHT LIMIT:\nANY PALLET / BUNDLE / CRATE WEIGHING MORE THAN 8,000 POUNDS (LBS) IS SUBJECT TO ADDITIONAL HANDLING FEES.\n\nSIZE LIMIT:\nANY PALLET / CRATE / BUNDLE EXCEEDING 120 INCHES IN LENGTH, OR REQUIRING SPECIAL HANDLING DUE TO DIMENSIONS OR SHAPE, WILL BE CONSIDERED OVERSIZED AND SUBJECT TO ADDITIONAL HANDLING FEES.\n\nEXTREME OW / OD:\nCARGO WEIGHING MORE THAN 12,000 LBS OR EXCEEDING 288 INCHES IN LENGTH WILL BE CONSIDERED EXTREME OW / OD\nAND WILL BE SUBJECT TO ADDITIONAL CHARGES BASED ON ACTUAL OPERATING REQUIREMENTS."
 },
 {
  "pageKey": "tl_fcl_f2p",
  "title": "FCL-Floor to Pallet",
  "category": "Transload (Cross Dock)",
  "sortOrder": 60,
  "layout": "price",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "● Floor Load",
    "rows": []
   },
   {
    "heading": "○ Floor to Pallet transload (Hand unload + palletizing + pallet outbound)",
    "rows": [
     {
      "description": "Order Processing Fee",
      "price": "25.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Unloading Fee",
    "rows": [
     {
      "description": "< 500 boxes",
      "price": "400.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "501 ~ 1200 boxes",
      "price": "500.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "1201 ~ 2000 boxes",
      "price": "600.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "2001 ~ 3000 boxes",
      "price": "680.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "3001 ~ 4000 boxes",
      "price": "780.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "> 4000 boxes",
      "price": "800.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Staging and stretch wrapping",
      "price": "8.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "INCLUDING STRETCH WRAP, 10 PER PALLET IF MORE THAN 2000 BOXES PER CONTAINER"
     },
     {
      "description": "+ Sorting Fee",
      "price": "6.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$8/PALLET IF MORE THAN 2000 CARTONS PER CONTAINER"
     },
     {
      "description": "+ 40\" x 48\" Standard Pallet",
      "price": "8.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$10 for CA"
     },
     {
      "description": "+ Handling Out per 40\" x 48\" Standard Pallet",
      "price": "10.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$5/pallet if TTS arranges delivery."
     }
    ]
   },
   {
    "heading": "Surcharges (if applicable)",
    "rows": [
     {
      "description": "+ Oversize / overweight handling fee per unit (Unit > 50LBS or package that exceeds 48 inches in length or 68 inches in length and girth)",
      "price": "0.65",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Oversize / overweight handling fee per container\n (Unit > 50LBS or package that exceeds 48 inches in length or 68 inches in length and girth)",
      "price": "150.00",
      "unit": "Container",
      "minChg": "",
      "notes": "Over weight or over size per 20' container"
     },
     {
      "description": "+ Oversize / overweight handling fee per container\n (Unit > 50LBS or package that exceeds 48 inches in length or 68 inches in length and girth)",
      "price": "200.00",
      "unit": "Container",
      "minChg": "",
      "notes": "Over weight or over size per 40' container"
     },
     {
      "description": "Sorting & segregation by SKU or PO - per SKU per container with >10 SKU",
      "price": "15.00",
      "unit": "SKU",
      "minChg": "",
      "notes": "additional sorting fee if >10 SKU per container"
     },
     {
      "description": "Storage 0-3 days per pallet (standard 40\" x 48\" pallet)",
      "price": "Free",
      "unit": "Pallet",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Storage per standard pallet per week after 3 days (stackable)",
      "price": "5.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$8/pallet for CA & NJ"
     },
     {
      "description": "Storage per container per week after 3 days",
      "price": "150.00",
      "unit": "40' container",
      "minChg": "",
      "notes": "$250/container for CA & NJ"
     }
    ]
   }
  ],
  "pageNote": ""
 },
 {
  "pageKey": "tl_fcl_f2f",
  "title": "FCL-Floor to Floor",
  "category": "Transload (Cross Dock)",
  "sortOrder": 70,
  "layout": "price",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "● Floor Load",
    "rows": []
   },
   {
    "heading": "○ Floor to Floor transload",
    "rows": [
     {
      "description": "Order Processing Fee",
      "price": "25.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Cargo Transload - Floor to Floor",
    "rows": [
     {
      "description": "< 500 boxes",
      "price": "800.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "501 ~ 1200 boxes",
      "price": "1000.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "1201 ~ 2000 boxes",
      "price": "1200.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "2001 ~ 3000 boxes",
      "price": "1360.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "3001 ~ 4000 boxes",
      "price": "1560.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "> 4000 boxes",
      "price": "Quote",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Surcharges （if applicable）",
    "rows": [
     {
      "description": "+ Oversize / overweight handling fee per unit (Unit > 50LBS or package that exceeds 48 inches in length)",
      "price": "1.25",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Oversize / overweight handling fee per container\n (Unit > 50LBS or package that exceeds 48 inches in length)",
      "price": "200.00",
      "unit": "20'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Oversize / overweight handling fee per container\n (Unit > 50LBS or package that exceeds 48 inches in length)",
      "price": "250.00",
      "unit": "40'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Storage 0-3 days per pallet (standard 40\" x 48\" pallet)",
      "price": "Free",
      "unit": "Pallet",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Storage per standard pallet per week after 3 days (stackable)",
      "price": "5.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$8/pallet for CA & NJ"
     },
     {
      "description": "Storage per container per week after 3 days",
      "price": "150.00",
      "unit": "40' container",
      "minChg": "",
      "notes": "$250/container for CA & NJ"
     }
    ]
   }
  ],
  "pageNote": "OD / OW DEFINITION – PALLET / CRATE / BUNDLE:\n\nOW HANDLING FEES VARY DEPENDING ON THE DEGREE OF OVERWEIGHT, CARGO STABILITY, AND ACTUAL HANDLING COMPLEXITY.\n\nWEIGHT LIMIT:\nANY PALLET / BUNDLE / CRATE WEIGHING MORE THAN 8,000 POUNDS (LBS) IS SUBJECT TO ADDITIONAL HANDLING FEES.\n\nSIZE LIMIT:\nANY PALLET / CRATE / BUNDLE EXCEEDING 120 INCHES IN LENGTH, OR REQUIRING SPECIAL HANDLING DUE TO DIMENSIONS OR SHAPE, WILL BE CONSIDERED OVERSIZED AND SUBJECT TO ADDITIONAL HANDLING FEES.\n\nEXTREME OW / OD:\nCARGO WEIGHING MORE THAN 12,000 LBS OR EXCEEDING 288 INCHES IN LENGTH WILL BE CONSIDERED EXTREME OW / OD\nAND WILL BE SUBJECT TO ADDITIONAL CHARGES BASED ON ACTUAL OPERATING REQUIREMENTS."
 },
 {
  "pageKey": "db_fcl_pal",
  "title": "FCL-Palletized IB + LTL out",
  "category": "Distribution (B2B)",
  "sortOrder": 80,
  "layout": "price",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "● Per Container, Palletized",
    "rows": [
     {
      "description": "Inbound Receipt Processing Fee",
      "price": "15.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Handling In per 20' - Palletized",
      "price": "180.00",
      "unit": "20'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Handling In per 40' - Palletized",
      "price": "250.00",
      "unit": "40' / 40'HQ",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Handling In per 40HQ/45' - Palletized",
      "price": "300.00",
      "unit": "45'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Handling In per 53' - Palletized",
      "price": "350.00",
      "unit": "53'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Handling in per Pallet (standard 40\" x 48\" pallet)",
      "price": "10.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Surcharges (if applicable)",
    "rows": [
     {
      "description": "+ Sorting & segregation by SKU - per Pallet",
      "price": "20.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "Including Depalletizing and Repalletizing"
     },
     {
      "description": "+Oversize/overweight handling fee per pallet",
      "price": "Quote",
      "unit": "Pallet",
      "minChg": "",
      "notes": "Quote by case"
     },
     {
      "description": "+ Oversize /overweight handling fee per container",
      "price": "100.00",
      "unit": "20'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Oversize / overweight handling fee per container",
      "price": "150.00",
      "unit": "40'",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Warehouse Services - Distribution Service (LTL Out)",
    "rows": []
   },
   {
    "heading": "● FTL / LTL (Palletized)",
    "rows": [
     {
      "description": "Outbound Order Processing Fee (FTL/LTL)",
      "price": "15.00",
      "unit": "BOL",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Order Picking per Pallet",
      "price": "20.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "<=5sku/pallet"
     },
     {
      "description": "Staging & Palletizing",
      "price": "8.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Standard Grade B 40\" x 48\" Pallet",
      "price": "8.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$10 for CA"
     },
     {
      "description": "Handling Out per 40\" x 48\" Standard Pallet",
      "price": "10.00",
      "unit": "Pallet",
      "minChg": "25.00",
      "notes": "$10 + $15 order processing fee"
     },
     {
      "description": "Handling Out per 53' - Palletized",
      "price": "300.00",
      "unit": "53'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Rush Order Fee: Receiving an outbound order without a 24H prenotification showing BOL with SKU#, QTY... etc.",
      "price": "150.00",
      "unit": "FTL",
      "minChg": "",
      "notes": "$150/FTL or $25/pallet"
     },
     {
      "description": "Storage 0-3 days per pallet (standard 40\" x 48\" pallet)",
      "price": "Free",
      "unit": "Pallet",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Storage per standard pallet per month after 3 days (stackable)",
      "price": "20.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$30/pallet for CA & NJ"
     }
    ]
   }
  ],
  "pageNote": "Orders received before 2:00 PM:\nIf an order is received before 2:00 PM on a business day, the warehouse will ship it on the next business day. For example, if an order is received at 1:30 PM on Monday, it will be shipped on Tuesday.\n\nOrders received after 2:00 PM:\nIf an order is received after 2:00 PM on a business day, the warehouse will ship it on the second business day. For example, if an order is received at 3:30 PM on Monday, it will be shipped on Wednesday.\n\nRush Order Fee:\nFor all orders received after 2:00pm (local wh time) and need to be shipped in the next business day, RUSH ORDER FEE will be applied.\n\nOne month’s storage fee will apply to Goods received on or before the 15th calendar day of that month. Half a month’s storage fee will apply to Goods received between 16th and 25th calendar day of that month. Storage fee will be waived for Goods received on or after the 26th calendar day of that month. First Month Storage fee is billed upon receipt. Recurring storage fee is billed on the 1st day of each month at full month rate. NON-PRORATED.\n\nWAREHOUSEMAN DOES NOT INSURE THE GOODS WHILE IN STORAGE, AND THE STORAGE RATES OR CHARGES BILLED TO DEPOSITOR DO NOT INCLUDE ANY INSURANCE ON THE GOODS. THE GOODS WILL THEREFORE NOT BE INSURED FOR ANY LOSS OR DAMAGE HOWEVER CAUSED. DEPOSITOR IS RESPONSIBLE FOR INSURING GOODS TENDERED FOR STORAGE. IF NONE IS PROCURED, DEPOSITOR IS DEEMED TO HAVE ELECTED TO SELF-INSURE."
 },
 {
  "pageKey": "db_fcl_floor",
  "title": "FCL-Floorload IB + LTL out",
  "category": "Distribution (B2B)",
  "sortOrder": 90,
  "layout": "price",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "● Per Container, Floor Load (for Distribution and Fulfillment Containers)",
    "rows": [
     {
      "description": "Inbound Receipt Processing Fee",
      "price": "15.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Floor-load Cargo Devan without sorting - floor to Pallet",
    "rows": [
     {
      "description": "< 500 boxes",
      "price": "400.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "501 ~ 1200 boxes",
      "price": "500.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "1201 ~ 2000 boxes",
      "price": "600.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "2001 ~ 3000 boxes",
      "price": "680.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "3001 ~ 4000 boxes",
      "price": "780.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "> 4000 boxes",
      "price": "800.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Sorting",
      "price": "6.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$8/PALLET IF MORE THAN 2000 CARTONS PER CONTAINER"
     },
     {
      "description": "+ Palletizing & Stocking",
      "price": "8.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "INCLUDING STRETCH WRAP, 10 PER PALLET IF MORE THAN 2000 BOXES PER CONTAINER"
     }
    ]
   },
   {
    "heading": "Surcharges (if applicable)",
    "rows": [
     {
      "description": "+ Oversize / overweight handling fee per unit (Unit > 50LBS or package that exceeds 48 inches in length)",
      "price": "0.65",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Oversize / overweight handling fee per container (Unit > 50LBS or package that exceeds 48 inches in length)",
      "price": "150.00",
      "unit": "20'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Oversize / overweight handling fee per container (Unit > 50LBS or package that exceeds 48 inches in length)",
      "price": "200.00",
      "unit": "40'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Rush Order Fee: Receiving an inbound shipment without a 24H prenotification showing SKU#, QTY, weight... etc.",
      "price": "150.00",
      "unit": "Order",
      "minChg": "",
      "notes": "$150.00/container or $25.00/pallet"
     }
    ]
   },
   {
    "heading": "Warehouse Services - Distribution Service (LTL Out)",
    "rows": []
   },
   {
    "heading": "● FTL / LTL (Palletized)",
    "rows": [
     {
      "description": "Outbound Order Processing Fee (FTL/LTL)",
      "price": "15.00",
      "unit": "BOL",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Order Picking per Pallet",
      "price": "20.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "<=5sku/pallet, $5/5sku after"
     },
     {
      "description": "Staging & Palletizing",
      "price": "8.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Standard Grade B 40\" x 48\" Pallet",
      "price": "8.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$10 for CA"
     },
     {
      "description": "Handling Out per 40\" x 48\" Standard Pallet",
      "price": "10.00",
      "unit": "Pallet",
      "minChg": "25.00",
      "notes": "$10 + $15 order processing fee"
     },
     {
      "description": "+ Rush Order Fee: Receiving an outbound order without a 24H prenotification showing BOL with SKU#, QTY... etc.",
      "price": "150.00",
      "unit": "FTL",
      "minChg": "",
      "notes": "$150/FTL or $25/pallet"
     }
    ]
   },
   {
    "heading": "Warehouse Services - Storage",
    "rows": []
   },
   {
    "heading": "",
    "rows": [
     {
      "description": "Storage per standard pallet per month after 3 days (stackable)",
      "price": "20.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$30/pallet for CA & NJ"
     }
    ]
   }
  ],
  "pageNote": "Orders received before 2:00 PM:\nIf an order is received before 2:00 PM on a business day, the warehouse will ship it on the next business day. For example, if an order is received at 1:30 PM on Monday, it will be shipped on Tuesday.\n\nOrders received after 2:00 PM:\nIf an order is received after 2:00 PM on a business day, the warehouse will ship it on the second business day. For example, if an order is received at 3:30 PM on Monday, it will be shipped on Wednesday.\n\nRush Order Fee:\nFor all orders received after 2:00pm (local wh time) and need to be shipped in the next business day, RUSH ORDER FEE will be applied.\n\nOne month’s storage fee will apply to Goods received on or before the 15th calendar day of that month. Half a month’s storage fee will apply to Goods received between 16th and 23th calendar day of that month. Storage fee will be waived for Goods received on or after the 24th calendar day of that month. First Month Storage fee is billed upon receipt. Recurring storage fee is billed on the 1st day of each month at full month rate. NON-PRORATED.\n\nWAREHOUSEMAN DOES NOT INSURE THE GOODS WHILE IN STORAGE, AND THE STORAGE RATES OR CHARGES BILLED TO DEPOSITOR DO NOT INCLUDE ANY INSURANCE ON THE GOODS. THE GOODS WILL THEREFORE NOT BE INSURED FOR ANY LOSS OR DAMAGE HOWEVER CAUSED. DEPOSITOR IS RESPONSIBLE FOR INSURING GOODS TENDERED FOR STORAGE. IF NONE IS PROCURED, DEPOSITOR IS DEEMED TO HAVE ELECTED TO SELF-INSURE."
 },
 {
  "pageKey": "ff_fcl_pal",
  "title": "FCL-Palletized IB + SP out",
  "category": "Fulfillment (B2C)",
  "sortOrder": 100,
  "layout": "price",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "● Per Container, Palletized",
    "rows": [
     {
      "description": "Inbound Receipt Processing Fee",
      "price": "15.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Handling In per 20' - Palletized",
      "price": "180.00",
      "unit": "20'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Handling In per 40' - Palletized",
      "price": "250.00",
      "unit": "40' / 40'HQ",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Handling In per 40HQ/45' - Palletized",
      "price": "300.00",
      "unit": "45'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Handling In per 53' - Palletized",
      "price": "350.00",
      "unit": "53'",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Surcharges (if applicable)",
    "rows": [
     {
      "description": "+ Sorting & segregation by SKU - per Pallet",
      "price": "10.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "If needed"
     },
     {
      "description": "+ Oversize /overweight handling fee per container",
      "price": "100.00",
      "unit": "20'",
      "minChg": "",
      "notes": "If applicable"
     },
     {
      "description": "+ Oversize / overweight handling fee per container",
      "price": "150.00",
      "unit": "40'",
      "minChg": "",
      "notes": "If applicable"
     }
    ]
   },
   {
    "heading": "Warehouse Services - Fulfillment Service (Small Parcel Out)",
    "rows": []
   },
   {
    "heading": "● E-Commerce Fulfillment & Small Parcel Order",
    "rows": [
     {
      "description": "Daily Fulfillment Order Processing Fee",
      "price": "Quote",
      "unit": "Order",
      "minChg": "",
      "notes": "Waived if using EDI"
     }
    ]
   },
   {
    "heading": "Fulfillment Order Picking per Unit (Pick multi units and ship in one carton, including picking, apply labels and loading to small parcel carrier)",
    "rows": [
     {
      "description": "0 < X <= 1 LBS",
      "price": "0.65",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "1 < X <= 2 LBS",
      "price": "1.00",
      "unit": "Unit",
      "minChg": "",
      "notes": "min 50 orders per day"
     },
     {
      "description": "2 < X <= 5 LBS",
      "price": "2.00",
      "unit": "Unit",
      "minChg": "",
      "notes": "under 5 sku and under 10 lbs per carton"
     },
     {
      "description": "5 < X <= 10 LBS",
      "price": "2.50",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Carton box",
      "price": "Quote",
      "unit": "Carton",
      "minChg": "",
      "notes": "Quote by case"
     }
    ]
   },
   {
    "heading": "Fulfillment Order Picking per Carton (Ship per carton, including picking, applying labels and loading to small parcel carrier)",
    "rows": [
     {
      "description": "0 < X <= 1 LB",
      "price": "0.65",
      "unit": "Unit",
      "minChg": "",
      "notes": "Min 100 orders/day"
     },
     {
      "description": "1 < X <= 5 LBS",
      "price": "2.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "5 < X <= 10 LBS",
      "price": "2.50",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "10 < X <= 25 LBS",
      "price": "3.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "25 < X <= 40 LBS",
      "price": "4.50",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "40 < X <= 55 LBS",
      "price": "6.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "55 < X <= 70 LBS",
      "price": "8.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "70 < X <= 90 LBS",
      "price": "10.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "90 < X <= 120 LBS",
      "price": "15.00",
      "unit": "Unit",
      "minChg": "",
      "notes": "Additional OD handling fee may applied"
     },
     {
      "description": "120 < X <= 150 LBS",
      "price": "20.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "> 150 LBS",
      "price": "Quote",
      "unit": "Each",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Surcharges (if applicable)",
    "rows": [
     {
      "description": "Daily small parcel outbound minimum charge",
      "price": "25.00",
      "unit": "day",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Oversize handling fee per unit (exceeds 68 inches in length or 80 inches in girth)",
      "price": "QUOTE",
      "unit": "Unit",
      "minChg": "",
      "notes": "Quote by case"
     },
     {
      "description": "+ Rush order after cut off time",
      "price": "5.00",
      "unit": "Order",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Storage Fee",
    "rows": [
     {
      "description": "Storage per CBF per day (1-7 days)",
      "price": "0.00",
      "unit": "CBF",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Storage per CBF per day (8-30 days)",
      "price": "0.02",
      "unit": "CBF",
      "minChg": "",
      "notes": "0.025 for CA & NJ"
     },
     {
      "description": "Storage per CBF per day (30-60 days)",
      "price": "0.03",
      "unit": "CBF",
      "minChg": "",
      "notes": "0.035 for CA & NJ"
     },
     {
      "description": "Storage per CBF per day (60-90 days)",
      "price": "0.04",
      "unit": "CBF",
      "minChg": "",
      "notes": "0.050 for CA & NJ"
     },
     {
      "description": "Storage per CBF per day (90-120 days)",
      "price": "0.05",
      "unit": "CBF",
      "minChg": "",
      "notes": "0.060 for CA & NJ"
     },
     {
      "description": "Storage per CBF per day (>120 days)",
      "price": "0.06",
      "unit": "CBF",
      "minChg": "",
      "notes": "0.075 for CA & NJ"
     }
    ]
   }
  ],
  "pageNote": "Orders received before 12:00 PM:\nIf an order is received before 12:00 PM on a business day, the warehouse will ship it on the same business day. \n\nOrders received after 12:00 PM:\nIf an order is received after 12:00 PM on a business day, the warehouse will ship it on the next business day. \n\nRush Order Fee:\nFor all orders received after 12:00pm (local wh time) and need to be shipped on the same business day, RUSH ORDER FEE will be applied. (Warehouse can't guarantee the orders will be picked up by the small parcel carrier. )\n\nOne month’s storage fee will apply to Goods received on or before the 15th calendar day of that month. Half a month’s storage fee will apply to Goods received between 16th and 25th calendar day of that month. Storage fee will be waived for Goods received on or after the 26th calendar day of that month. First Month Storage fee is billed upon receipt. Recurring storage fee is billed on the 1st day of each month at full month rate. NON-PRORATED.\n\nWAREHOUSEMAN DOES NOT INSURE THE GOODS WHILE IN STORAGE, AND THE STORAGE RATES OR CHARGES BILLED TO DEPOSITOR DO NOT INCLUDE ANY INSURANCE ON THE GOODS. THE GOODS WILL THEREFORE NOT BE INSURED FOR ANY LOSS OR DAMAGE HOWEVER CAUSED. DEPOSITOR IS RESPONSIBLE FOR INSURING GOODS TENDERED FOR STORAGE. IF NONE IS PROCURED, DEPOSITOR IS DEEMED TO HAVE ELECTED TO SELF-INSURE."
 },
 {
  "pageKey": "ff_fcl_floor",
  "title": "FCL-Floorload IB + SP out",
  "category": "Fulfillment (B2C)",
  "sortOrder": 110,
  "layout": "price",
  "validThrough": "2026-12-31",
  "sections": [
   {
    "heading": "● Per Container, Floor Load (for Distribution and Fulfillment Containers)",
    "rows": [
     {
      "description": "Inbound Receipt Processing Fee",
      "price": "15.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Floor-load Cargo Devan without sorting - floor to Pallet",
    "rows": [
     {
      "description": "< 500 boxes",
      "price": "400.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "501 ~ 1200 boxes",
      "price": "500.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "1201 ~ 2000 boxes",
      "price": "600.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "2001 ~ 3000 boxes",
      "price": "680.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "3001 ~ 4000 boxes",
      "price": "780.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "> 4000 boxes",
      "price": "800.00",
      "unit": "Container",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Sorting",
      "price": "6.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "$8/PALLET IF MORE THAN 2000 CARTONS PER CONTAINER"
     },
     {
      "description": "+ Palletizing & Stocking",
      "price": "8.00",
      "unit": "Pallet",
      "minChg": "",
      "notes": "INCLUDING STRETCH WRAP, 10 PER PALLET IF MORE THAN 2000 BOXES PER CONTAINER"
     }
    ]
   },
   {
    "heading": "Surcharges (if applicable)",
    "rows": [
     {
      "description": "+ Oversize / overweight handling fee per unit (Unit > 50LBS or package that exceeds 48 inches in length)",
      "price": "0.65",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Oversize / overweight handling fee per container (Unit > 50LBS or package that exceeds 48 inches in length)",
      "price": "150.00",
      "unit": "20'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Oversize / overweight handling fee per container (Unit > 50LBS or package that exceeds 48 inches in length)",
      "price": "200.00",
      "unit": "40'",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Sorting & segregation by SKU or PO - per SKU per container with > 10 SKU",
      "price": "20.00",
      "unit": "SKU",
      "minChg": "",
      "notes": "additional sorting fee if more than 10 SKU"
     },
     {
      "description": "Rush Order Fee: Receiving an inbound shipment without a 24H prenotification showing SKU#, QTY, weight... etc.",
      "price": "150.00",
      "unit": "Order",
      "minChg": "",
      "notes": "$150.00/container or $25.00/pallet"
     }
    ]
   },
   {
    "heading": "Warehouse Services - Fulfillment Service (Small Parcel Out)",
    "rows": []
   },
   {
    "heading": "● E-Commerce Fulfillment & Small Parcel Order",
    "rows": [
     {
      "description": "Daily Fulfillment Order Processing Fee",
      "price": "Quote",
      "unit": "Order",
      "minChg": "",
      "notes": "Waived if using EDI"
     }
    ]
   },
   {
    "heading": "Fulfillment Order Picking per Unit (Pick multi units and ship in one carton, including picking, apply labels and loading to small parcel carrier)",
    "rows": [
     {
      "description": "0 < X <= 1 LBS",
      "price": "0.65",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "1 < X <= 2 LBS",
      "price": "1.00",
      "unit": "Unit",
      "minChg": "",
      "notes": "min 50 orders per day"
     },
     {
      "description": "2 < X <= 5 LBS",
      "price": "2.00",
      "unit": "Unit",
      "minChg": "",
      "notes": "under 5 sku and under 10 lbs per carton"
     },
     {
      "description": "5 < X <= 10 LBS",
      "price": "2.50",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Carton box",
      "price": "Quote",
      "unit": "Carton",
      "minChg": "",
      "notes": "Quote by case"
     }
    ]
   },
   {
    "heading": "Fulfillment Order Picking per Carton (Ship per carton, including picking, applying labels and loading to small parcel carrier)",
    "rows": [
     {
      "description": "0 < X <= 1 LB",
      "price": "0.65",
      "unit": "Unit",
      "minChg": "",
      "notes": "Min 100 orders/day"
     },
     {
      "description": "1 < X <= 5 LBS",
      "price": "2.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "5 < X <= 10 LBS",
      "price": "2.50",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "10 < X <= 25 LBS",
      "price": "3.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "25 < X <= 40 LBS",
      "price": "4.50",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "40 < X <= 55 LBS",
      "price": "6.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "55 < X <= 70 LBS",
      "price": "8.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "70 < X <= 90 LBS",
      "price": "10.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "90 < X <= 120 LBS",
      "price": "15.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "120 < X <= 150 LBS",
      "price": "20.00",
      "unit": "Unit",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "> 150 LBS",
      "price": "Quote",
      "unit": "Each",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Surcharges (if applicable)",
    "rows": [
     {
      "description": "Daily small parcel outbound minimum charge",
      "price": "25.00",
      "unit": "day",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "+ Oversize handling fee per unit (exceeds 68 inches in length or 80 inches in girth)",
      "price": "QUOTE",
      "unit": "Unit",
      "minChg": "",
      "notes": "Quote by case"
     },
     {
      "description": "+ Rush order after cut off time",
      "price": "5.00",
      "unit": "Order",
      "minChg": "",
      "notes": ""
     }
    ]
   },
   {
    "heading": "Storage Fee",
    "rows": [
     {
      "description": "Storage per CBF per day (1-7 days)",
      "price": "0.00",
      "unit": "CBF",
      "minChg": "",
      "notes": ""
     },
     {
      "description": "Storage per CBF per day (8-30 days)",
      "price": "0.02",
      "unit": "CBF",
      "minChg": "",
      "notes": "0.025 for CA & NJ"
     },
     {
      "description": "Storage per CBF per day (30-60 days)",
      "price": "0.03",
      "unit": "CBF",
      "minChg": "",
      "notes": "0.035 for CA & NJ"
     },
     {
      "description": "Storage per CBF per day (60-90 days)",
      "price": "0.04",
      "unit": "CBF",
      "minChg": "",
      "notes": "0.050 for CA & NJ"
     },
     {
      "description": "Storage per CBF per day (90-120 days)",
      "price": "0.05",
      "unit": "CBF",
      "minChg": "",
      "notes": "0.060 for CA & NJ"
     },
     {
      "description": "Storage per CBF per day (>120 days)",
      "price": "0.06",
      "unit": "CBF",
      "minChg": "",
      "notes": "0.075 for CA & NJ"
     }
    ]
   }
  ],
  "pageNote": "Orders received before 12:00 PM:\nIf an order is received before 12:00 PM on a business day, the warehouse will ship it on the same business day. \n\nOrders received after 12:00 PM:\nIf an order is received after 12:00 PM on a business day, the warehouse will ship it on the next business day. \n\nRush Order Fee:\nFor all orders received after 12:00pm (local wh time) and need to be shipped on the same business day, RUSH ORDER FEE will be applied. (Warehouse can't guarantee the orders will be picked up by the small parcel carrier. )\n\nOne month’s storage fee will apply to Goods received on or before the 15th calendar day of that month. Half a month’s storage fee will apply to Goods received between 16th and 25th calendar day of that month. Storage fee will be waived for Goods received on or after the 26th calendar day of that month. First Month Storage fee is billed upon receipt. Recurring storage fee is billed on the 1st day of each month at full month rate. NON-PRORATED.\n\nWAREHOUSEMAN DOES NOT INSURE THE GOODS WHILE IN STORAGE, AND THE STORAGE RATES OR CHARGES BILLED TO DEPOSITOR DO NOT INCLUDE ANY INSURANCE ON THE GOODS. THE GOODS WILL THEREFORE NOT BE INSURED FOR ANY LOSS OR DAMAGE HOWEVER CAUSED. DEPOSITOR IS RESPONSIBLE FOR INSURING GOODS TENDERED FOR STORAGE. IF NONE IS PROCURED, DEPOSITOR IS DEEMED TO HAVE ELECTED TO SELF-INSURE."
 }
];

(async () => {
  const write = process.argv.includes('--write');
  console.log((write ? 'WRITE MODE' : 'DRY RUN (no changes; add --write to execute)'));
  let total = 0;
  for (const p of PAGES) {
    const rows = p.sections.reduce((n, s) => n + s.rows.length, 0);
    total += rows;
    console.log(' -', p.pageKey.padEnd(20), p.title.padEnd(30), 'sections=' + p.sections.length, 'rows=' + rows);
  }
  console.log('TOTAL pages=' + PAGES.length + ' rows=' + total);
  if (!write) { process.exit(0); }

  const { MongoClient } = require('mongodb');
  const uri = process.env.MONGO_URI_NEW || process.env.MONGO_URI;
  if (!uri) { console.error('No MONGO_URI'); process.exit(1); }
  const c = new MongoClient(uri);
  await c.connect();
  const col = c.db().collection('list_prices');
  for (const p of PAGES) {
    p.updatedAt = new Date();
    const r = await col.updateOne({ pageKey: p.pageKey }, { $set: p }, { upsert: true });
    console.log('upserted', p.pageKey, r.upsertedCount ? '(new)' : '(updated)');
  }
  const n = await col.countDocuments();
  console.log('DONE. list_prices now has', n, 'documents.');
  await c.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
