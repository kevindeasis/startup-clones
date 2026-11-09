"""Seed the DB (catalog, customers, history) and generate sample inbound files.

Usage: python -m app.seed [--reset]
"""
from __future__ import annotations

import datetime as dt
import sys
from email.message import EmailMessage

from sqlmodel import Session, SQLModel, select

from .db import SAMPLES_DIR, engine, init_db
from .models import Customer, CustomerAlias, ErpOrder, ErpOrderLine, Product

# sku, name, unit, pack, category, aliases
CATALOG = [
    ("HAMACHI-LOIN", "Hamachi Loin", "cs", "10 lb case", "Fish", "yellowtail,buri,hamachi"),
    ("KAMPACHI-FIL", "Kampachi Fillet", "lb", "2-3 lb fillet", "Fish", "amberjack,kanpachi"),
    ("SALMON-FIL-ATL", "Salmon Fillet Atlantic", "lb", "10 lb case", "Fish", "salmon,salmón,salmon fillet,salmon filet"),
    ("SALMON-PORT-6OZ", "Salmon Portions 6 oz", "cs", "10 lb case (27 x 6 oz)", "Fish", "salmon portions,salmon portion"),
    ("SALMON-SMOKED", "Smoked Salmon Sliced", "lb", "2 lb pack", "Fish", "lox,nova,smoked salmon"),
    ("TUNA-AHI-SAKU", "Ahi Tuna Saku", "lb", "5 lb pack", "Fish", "ahi,yellowfin,maguro,ahi saku"),
    ("TUNA-BLUEFIN-OTORO", "Bluefin Otoro", "lb", "1 lb block", "Fish", "otoro,fatty tuna,toro"),
    ("TUNA-BLUEFIN-AKAMI", "Bluefin Akami", "lb", "2 lb block", "Fish", "akami"),
    ("UNI-TRAY", "Uni Tray (Sea Urchin)", "tray", "100 g tray", "Shellfish", "uni,sea urchin,erizo"),
    ("HOTATE-U10", "Hotate (Scallops) U10", "lb", "5 lb tub", "Shellfish", "hotate,scallops,scallop,vieiras"),
    ("EBI-16-20", "Ebi 16/20", "lb", "2 lb box", "Shellfish", "ebi"),
    ("SHRIMP-2125-PD", "Shrimp 21/25 P&D", "cs", "10 lb case", "Shellfish", "shrimp,camaron,camarones,camarón,prawns"),
    ("OYSTER-KUM", "Oysters Kumamoto", "dz", "dozen", "Shellfish", "kumamoto,kumamotos,ostiones,ostras kumamoto"),
    ("OYSTER-KUS", "Oysters Kusshi", "dz", "dozen", "Shellfish", "kusshi,kusshis,ostras kusshi"),
    ("MUSSELS-PEI", "Mussels PEI", "cs", "10 lb bag", "Shellfish", "mussels,mejillones,pei mussels"),
    ("CLAMS-MANILA", "Clams Manila", "lb", "10 lb bag", "Shellfish", "manila clams,clams,almejas"),
    ("HALIBUT-FIL", "Halibut Fillet", "lb", "10 lb case", "Fish", "halibut,hirame halibut"),
    ("BLACKCOD-FIL", "Black Cod (Sablefish)", "lb", "10 lb case", "Fish", "sablefish,gindara,black cod,bacalao negro"),
    ("BRANZINO-WHL", "Branzino Whole", "ea", "1-1.5 lb each", "Fish", "branzino,lubina,mediterranean sea bass"),
    ("SNAPPER-WHL", "Red Snapper Whole", "ea", "2-3 lb each", "Fish", "red snapper,huachinango,snapper"),
    ("LOBSTER-TAIL-8OZ", "Lobster Tail 8 oz", "cs", "20 x 8 oz case", "Shellfish", "lobster tail,lobster tails,langosta"),
    ("KINGCRAB-LEGS", "King Crab Legs", "lb", "cluster, 10 lb box", "Shellfish", "king crab,king crab legs,alaskan king crab"),
    ("DUNGENESS-CRAB", "Dungeness Crab", "lb", "live, per lb", "Shellfish", "dungeness,dungeness crab,cangrejo dungeness"),
    ("OCTOPUS-TAKO", "Octopus (Tako)", "lb", "5 lb block", "Shellfish", "tako,octopus,pulpo"),
    ("SQUID-IKA", "Squid (Ika)", "lb", "5 lb block", "Shellfish", "ika,squid,calamar,calamari"),
    ("EEL-UNAGI", "Eel Unagi Kabayaki", "ea", "8 oz pack", "Fish", "unagi,eel,anguila,kabayaki"),
    ("MACKEREL-SABA", "Mackerel Saba Fillet", "lb", "5 lb case", "Fish", "saba,mackerel,caballa"),
    ("IKURA", "Ikura (Salmon Roe)", "lb", "1 kg tub", "Roe", "ikura,salmon roe,salmon caviar"),
    ("TOBIKO", "Tobiko (Flying Fish Roe)", "lb", "1 lb tub", "Roe", "tobiko,flying fish roe"),
    ("CRABMEAT-JLUMP", "Crab Meat Jumbo Lump", "lb", "1 lb tub", "Shellfish", "jumbo lump,crab meat,lump crab"),
    ("COD-LOIN", "Cod Loins", "lb", "10 lb case", "Fish", "cod,bacalao,cod loin"),
    ("SWORDFISH-STK", "Swordfish Steak", "lb", "10 lb case", "Fish", "swordfish,pez espada"),
    ("MAHI-FIL", "Mahi Mahi Fillet", "lb", "10 lb case", "Fish", "mahi,dorado"),
    ("MADAI-WHL", "Madai Sea Bream Whole", "ea", "2 lb each", "Fish", "madai,sea bream,tai"),
    ("HIRAME-FIL", "Hirame Fluke Fillet", "lb", "5 lb case", "Fish", "hirame,fluke,flounder"),
    ("AMAEBI", "Amaebi Sweet Shrimp", "lb", "1 lb box", "Shellfish", "amaebi,sweet shrimp"),
    ("KATSUO-LOIN", "Katsuo Skipjack Loin", "lb", "5 lb case", "Fish", "katsuo,skipjack,bonito"),
    ("SOFTSHELL-CRAB", "Soft Shell Crab", "cs", "24 ct case", "Shellfish", "soft shell,softshell,soft shell crab"),
    ("SCALLOP-BAY", "Bay Scallops", "lb", "5 lb tub", "Shellfish", "bay scallops"),
    ("TILEFISH-FIL", "Tilefish Fillet", "lb", "10 lb case", "Fish", "tilefish,amadai"),
]

CUSTOMERS = [
    ("Blue Fin Bistro", "orders@bluefinbistro.example,dana@bluefinbistro.example", "+1-555-0101",
     "English, texts shorthand. Delivery Tue/Fri."),
    ("Mariscos El Puerto", "pedidos@mariscoselpuerto.example,maria@mariscoselpuerto.example", "+1-555-0102",
     "Spanish emails. Delivery Mon/Fri."),
    ("Sakura Omakase", "chef@sakuraomakase.example", "+1-555-0103",
     "Japanese romaji shorthand. Orders uni and otoro. Delivery Tue/Thu."),
]

CUSTOMER_ALIASES = {
    "Blue Fin Bistro": [("hama", "HAMACHI-LOIN"), ("the usual salmon", "SALMON-FIL-ATL")],
    "Mariscos El Puerto": [("camaron grande", "SHRIMP-2125-PD")],
    "Sakura Omakase": [("hotate", "HOTATE-U10"), ("toro", "TUNA-BLUEFIN-OTORO")],
}

# (customer, days_ago_offset_from_last_friday_index, lines[(sku, qty, unit)])
def _history(today: dt.date):
    last_fri = today - dt.timedelta(days=(today.weekday() - 4) % 7 or 7)
    tue = last_fri - dt.timedelta(days=3)
    prev_fri = last_fri - dt.timedelta(days=7)
    thu = last_fri - dt.timedelta(days=1)
    return {
        "Blue Fin Bistro": [
            (last_fri, [("HAMACHI-LOIN", 2, "cs"), ("OYSTER-KUM", 3, "dz"), ("SALMON-FIL-ATL", 10, "lb")]),
            (tue, [("KAMPACHI-FIL", 4, "lb"), ("TUNA-AHI-SAKU", 5, "lb")]),
            (prev_fri, [("HAMACHI-LOIN", 1, "cs"), ("OYSTER-KUS", 2, "dz")]),
        ],
        "Mariscos El Puerto": [
            (last_fri, [("SHRIMP-2125-PD", 3, "cs"), ("OCTOPUS-TAKO", 10, "lb"), ("MUSSELS-PEI", 2, "cs")]),
            (prev_fri, [("SHRIMP-2125-PD", 2, "cs"), ("SQUID-IKA", 5, "lb")]),
            (tue, [("CLAMS-MANILA", 10, "lb")]),
        ],
        "Sakura Omakase": [
            (thu, [("UNI-TRAY", 6, "tray"), ("TUNA-BLUEFIN-OTORO", 3, "lb"), ("HOTATE-U10", 4, "lb")]),
            (tue, [("UNI-TRAY", 4, "tray"), ("IKURA", 2, "lb")]),
            (prev_fri, [("EEL-UNAGI", 6, "ea"), ("TUNA-BLUEFIN-OTORO", 2, "lb")]),
        ],
    }


def seed_db(reset: bool = False, today: dt.date | None = None) -> None:
    today = today or dt.date.today()
    if reset:
        SQLModel.metadata.drop_all(engine)
    init_db()
    with Session(engine, expire_on_commit=False) as s:
        if s.exec(select(Product)).first():
            return
        for sku, name, unit, pack, cat, aliases in CATALOG:
            s.add(Product(sku=sku, name=name, unit=unit, pack_size=pack, category=cat, aliases=aliases))
        custs = {}
        for name, emails, phones, notes in CUSTOMERS:
            c = Customer(name=name, contact_emails=emails, contact_phones=phones, notes=notes)
            s.add(c)
            custs[name] = c
        s.flush()
        for cname, items in CUSTOMER_ALIASES.items():
            for raw, sku in items:
                s.add(CustomerAlias(customer_id=custs[cname].id, raw_text_normalized=raw, sku=sku))
        names = {sku: name for sku, name, *_ in CATALOG}
        n = 1000
        events = []
        for cname, orders in _history(today).items():
            for day, lines in orders:
                events.append((day, cname, lines))
        for day, cname, lines in sorted(events, key=lambda e: e[0]):
            n += 1
            created = dt.datetime.combine(day, dt.time(9, 30))
            o = ErpOrder(erp_number=f"SO-{n}", customer_id=custs[cname].id, delivery_date=day, created_at=created)
            s.add(o)
            s.flush()
            for sku, qty, unit in lines:
                s.add(ErpOrderLine(erp_order_id=o.id, sku=sku, qty=qty, unit=unit, description=names[sku]))
        s.commit()


# ------------------------------------------------------------ sample files
SMS = "hey can i get 2 cs hama, 10lb salmon fillet and same as last friday for the oysters. friday delivery\n"

TABLE = """From: Dana Ruiz <dana@bluefinbistro.example>
Subject: Order for Tuesday

Hi team,

Please send the following for Tuesday:

Qty  Unit  Product
2    cs    Kampachi fillt
3    lb    Ahi tuna saku
1    cs    Dungenes crab
12   dz    Kumamoto oysters

Thanks,
Dana, Blue Fin Bistro
"""

EML_BODY = """Buenos días,

Necesito para el viernes:

| Cant | Unidad | Producto |
| 3 | cajas | camarón 21/25 |
| 10 | lb | pulpo |
| 2 | cajas | mejillones PEI |
| 5 | lb | calamar |

Gracias,
Maria — Mariscos El Puerto
"""

PDF_LINES = [
    "Sakura Omakase - Weekly Order Sheet",
    "Delivery: Tuesday",
    "",
    "Qty Unit Item",
    "4 tray Uni",
    "3 lb Otoro",
    "2 lb Hotate U10",
    "5 lb Ikura",
    "6 ea Unagi",
]


def write_samples() -> None:
    SAMPLES_DIR.mkdir(exist_ok=True)
    (SAMPLES_DIR / "sms_bluefin.txt").write_text(SMS)
    (SAMPLES_DIR / "email_table.txt").write_text(TABLE)
    msg = EmailMessage()
    msg["From"] = "Maria Lopez <maria@mariscoselpuerto.example>"
    msg["To"] = "orders@distributor.example"
    msg["Subject"] = "Pedido para el viernes"
    msg.set_content(EML_BODY, charset="utf-8")
    (SAMPLES_DIR / "email_elpuerto.eml").write_bytes(bytes(msg))
    try:
        from reportlab.pdfgen import canvas

        c = canvas.Canvas(str(SAMPLES_DIR / "pdf_order_sheet.pdf"))
        y = 800
        for line in PDF_LINES:
            c.drawString(60, y, line)
            y -= 22
        c.save()
    except ImportError:
        print("reportlab not installed: skipping pdf_order_sheet.pdf")
    _photo(SAMPLES_DIR / "photo_note.png")


def _photo(path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (900, 420), "white")
    try:
        font = ImageFont.load_default(size=44)
    except TypeError:
        font = ImageFont.load_default()
    lines = ["3 cs hotate U10", "2 lb ikura", "1 whole branzino", "- Sakura, Thurs"]
    for i, text in enumerate(lines):
        tile = Image.new("RGBA", (800, 80), (255, 255, 255, 0))
        ImageDraw.Draw(tile).text((10, 10), text, fill=(20, 20, 90, 255), font=font)
        tile = tile.rotate(-2 + i * 1.5, expand=True, resample=Image.BICUBIC)
        img.paste(tile, (40 + i * 8, 20 + i * 95), tile)
    img.save(path)


def main() -> None:
    seed_db(reset="--reset" in sys.argv)
    write_samples()
    with Session(engine) as s:
        print(f"products={len(s.exec(select(Product)).all())} customers={len(s.exec(select(Customer)).all())} "
              f"erp_orders={len(s.exec(select(ErpOrder)).all())} samples={len(list(SAMPLES_DIR.iterdir()))}")


if __name__ == "__main__":
    main()
