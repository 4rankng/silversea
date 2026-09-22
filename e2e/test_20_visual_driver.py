#!/usr/bin/env python3
"""
Visual QA for the driver app — tests against 2026.8.27 spec.
Uses an isolated native CUS/direct-dispatch fixture with exact-trip cleanup.
"""
import sys
import os
from urllib.parse import urlparse
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *
from test_20_driver_flow_e2e import create_driver_flow_fixture, cleanup_driver_flow_fixture


def verify_visual_driver(ctx: SilverseaTestContext, results: TestResults, fixture):
    """Visual + logical QA of the driver app against spec."""

    # ════════════════════════════════════════════════════════════════
    #  Spec §1: Bottom Navigation Bar (4 tabs)
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Spec §1: Navigation Structure")
    print(f"{'═'*60}")

    # Mobile viewport
    page = ctx.new_page(viewport={"width": 390, "height": 844})
    ctx.login_as("driver", page)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)

    # TC-3001: Driver lands on /my-trips
    if "/my-trips" in page.url:
        results.pass_("TC-3001", "Driver lands on /my-trips")
    else:
        results.fail("TC-3001", "Driver landing", f"URL: {page.url}")
    ctx.screenshot(page, "TC-3001_driver_landing")

    # TC-3002: Bottom nav has 4 tabs
    bottom_nav = page.get_by_role("navigation", name="Điều hướng chính", exact=True)
    nav_items = bottom_nav.locator("button:visible, a:visible").count() if bottom_nav.count() > 0 else 0
    if bottom_nav.is_visible() and nav_items == 4:
        results.pass_("TC-3002", f"Bottom nav: {nav_items} items")
    else:
        results.fail("TC-3002", "Bottom nav must have 4 tabs", f"Observed {nav_items} items")
    ctx.screenshot(page, "TC-3002_bottom_nav")

    # TC-3003: Bottom nav tabs are: Hành trình, Thu nhập, Kỷ luật, Tài khoản
    nav_text = bottom_nav.inner_text() if bottom_nav.count() > 0 else ""
    expected_tabs = ["Hành trình", "Thu nhập", "Kỷ luật", "Tài khoản"]
    found_tabs = [t for t in expected_tabs if t in nav_text]
    if len(found_tabs) == len(expected_tabs):
        results.pass_("TC-3003", f"Bottom nav tabs: {found_tabs}")
    else:
        results.fail("TC-3003", "Bottom nav tabs", f"Missing: {[tab for tab in expected_tabs if tab not in found_tabs]}; text: {nav_text[:100]}")
    ctx.screenshot(page, "TC-3003_nav_tabs")

    # ════════════════════════════════════════════════════════════════
    #  Spec §2: Hành trình screen — 3 sub-tabs
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Spec §2: Hành trình — 3 sub-tabs")
    print(f"{'═'*60}")

    # TC-3010: 3 sub-tabs: Lệnh mới | Đã nhận | Lịch sử
    tab_labels = ["Lệnh mới", "Đã nhận", "Lịch sử"]
    tabs_found = {}
    for label in tab_labels:
        tab = page.locator(f"button:has-text('{label}')")
        tabs_found[label] = tab.count() > 0
    if all(tabs_found.values()):
        results.pass_("TC-3010", "3 sub-tabs present: Lệnh mới, Đã nhận, Lịch sử")
    else:
        results.fail("TC-3010", "Sub-tabs", str(tabs_found))
    ctx.screenshot(page, "TC-3010_three_tabs")

    # TC-3011: "Lệnh mới" tab is active by default
    active_tab = page.locator("button.active:has-text('Lệnh mới'), button[aria-selected='true']:has-text('Lệnh mới')")
    if active_tab.count() > 0:
        results.pass_("TC-3011", "'Lệnh mới' tab is active by default")
    else:
        results.fail("TC-3011", "Default active tab", "No active 'Lệnh mới' tab was located")
    ctx.screenshot(page, "TC-3011_default_tab")

    # ════════════════════════════════════════════════════════════════
    #  Spec §2A: Layer 1 — Thẻ Tổng Quát (Card)
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Spec §2A: Layer 1 — Card content")
    print(f"{'═'*60}")

    cards = page.locator(".driver-journey-card").filter(has_text=fixture["trip"]["tripCode"])
    card_count = cards.count()
    if card_count > 0:
        results.pass_("TC-3020", f"{card_count} card(s) visible in Lệnh mới")

        card = cards.first

        # TC-3021: Header has [Tag: ĐƠN/KẸP] | Time
        tag = card.locator(".driver-journey-card__tag")
        time_el = card.locator(".driver-journey-card__time")
        if tag.count() > 0 and time_el.count() > 0:
            tag_text = tag.first.inner_text().strip()
            time_text = time_el.first.inner_text().strip()
            if tag_text in ("ĐƠN", "KẸP"):
                results.pass_("TC-3021", f"Header: [{tag_text}] | {time_text}")
            else:
                results.fail("TC-3021", "Card tag", f"Got '{tag_text}'")
        else:
            results.fail("TC-3021", "Card header", f"tag={tag.count()} time={time_el.count()}")

        # TC-3022: Factory (left) | Port (right) — the 9f0deb30 card rewrite
        # replaced the __row layout with named sections + a facts grid.
        factory = card.locator(".driver-journey-card__factory")
        route_el = card.locator(".driver-journey-card__route")
        if factory.count() > 0 and route_el.count() > 0:
            results.pass_("TC-3022", f"Factory + route sections visible")
        else:
            results.fail("TC-3022", "Own fixture card sections", f"factory={factory.count()} route={route_el.count()}")

        # TC-3023: Container number rendered bare in __cont-no (no "Cont:" label)
        cont = card.locator(".driver-journey-card__container")
        cont_no = card.locator(".driver-journey-card__cont-no")
        if cont.count() > 0 and cont_no.count() > 0 and cont_no.first.inner_text().strip() not in ("", "-"):
            results.pass_("TC-3023", f"Container: {cont.first.inner_text().strip()[:50]}")
        else:
            results.fail("TC-3023", "Container info", "Not found or no container number")

        # TC-3024: Footer: "Xem chi tiết & Nhận lệnh" button
        footer = card.locator(".driver-journey-card__footer")
        if footer.count() > 0:
            footer_text = footer.first.inner_text().strip()
            if "Xem chi tiết" in footer_text and "Nhận lệnh" in footer_text:
                results.pass_("TC-3024", f"Footer: '{footer_text}'")
            else:
                results.fail("TC-3024", "Footer text", f"Got: {footer_text}")
        else:
            results.fail("TC-3024", "Footer button", "Not found")
    else:
        results.fail("TC-3020", "No cards in Lệnh mới", "Cannot test Layer 1")
    ctx.screenshot(page, "TC-3020_layer1_cards")

    # ════════════════════════════════════════════════════════════════
    #  Spec §2B: Layer 2 — Thẻ Chi Tiết (Detail)
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Spec §2B: Layer 2 — Detail view")
    print(f"{'═'*60}")

    if card_count > 0:
        # Click first card's footer to open detail
        cards.first.locator(".driver-journey-card__footer").click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)
        selected_trip_id = urlparse(page.url).path.rstrip('/').rsplit('/', 1)[-1]

        # TC-3030: Navigated to /my-trips/:id
        if "/my-trips/" in page.url:
            results.pass_("TC-3030", "Detail page loaded", f"URL: {page.url}")
        else:
            results.fail("TC-3030", "Detail URL", f"URL: {page.url}")
        ctx.screenshot(page, "TC-3030_detail_page")

        # TC-3031: Block 1 (Lộ trình): Tuyến đường | Nhà máy | Cảng nâng | Cảng hạ
        route_section = page.locator("text=/tuyến|route|nhà máy|cảng/i")
        if route_section.count() > 0:
            results.pass_("TC-3031", "Block 1: Lộ trình section visible")
        else:
            results.fail("TC-3031", "Block 1: Route", "Expected route section was not located")
        ctx.screenshot(page, "TC-3031_block1_route")

        # TC-3032: Block 2 (Hàng hóa): Loại Cont | Số Cont | Số Chì + Camera button
        cont_section = page.locator("text=/cont|container|số cont|seal|chì/i")
        camera_btn = page.locator("button:has-text('Chụp'), [aria-label*='chụp'], [aria-label*='camera']")
        if cont_section.count() > 0:
            cam_info = f", camera={'yes' if camera_btn.count() > 0 else 'no'}"
            results.pass_("TC-3032", f"Block 2: Hàng hóa visible{cam_info}")
        else:
            results.fail("TC-3032", "Block 2: Container info", "Not found")
        ctx.screenshot(page, "TC-3032_block2_cargo")

        # TC-3033: Block 3 (Liên hệ): Name + Phone
        contact = page.locator("text=/liên hệ|phụ trách|sđt|điện thoại|phone/i")
        if contact.count() > 0:
            results.pass_("TC-3033", "Block 3: Liên hệ visible")
        else:
            results.fail("TC-3033", "Block 3: Contact", "Expected contact section was not located")

        # Current PRD section 3 removes duplicate truck/trailer detail rows.
        vehicle_rows = page.get_by_text("Đầu kéo", exact=True).count() + page.get_by_text("Rơ moóc", exact=True).count()
        if vehicle_rows == 0:
            results.pass_("TC-3034", "No duplicate truck/trailer rows in order detail")
        else:
            results.fail("TC-3034", "Duplicate vehicle rows in order detail", f"rows={vehicle_rows}")
        ctx.screenshot(page, "TC-3034_block6_vehicle")

        # TC-3035: Block 7 (Sticky Bottom): "Nhận lệnh vận chuyển"
        accept_btn = page.locator("button:has-text('Nhận lệnh vận chuyển')")
        if accept_btn.count() > 0:
            results.pass_("TC-3035", "Block 7: 'Nhận lệnh vận chuyển' sticky button")
            ctx.screenshot(page, "TC-3035_accept_button")
        else:
            all_btns = page.locator("button").all_text_contents()
            accept_variants = [b.strip() for b in all_btns if "nhận" in b.lower() or "lệnh" in b.lower()]
            if accept_variants:
                results.fail("TC-3035", "Acceptance control was not identified", f"Only ambiguous text candidates found: {accept_variants[:3]}")
            else:
                results.fail("TC-3035", "Accept button", "Not found")

        # TC-3036: Sticky button is pinned to bottom (position: fixed or sticky)
        if accept_btn.count() > 0:
            is_sticky = page.evaluate("""
                () => {
                    const btn = document.querySelector('[data-testid="accept-sticky-bar"]');
                    if (!btn) return 'no-element';
                    const style = window.getComputedStyle(btn);
                    return style.position;
                }
            """)
            if is_sticky in ("fixed", "sticky"):
                results.pass_("TC-3036", f"Sticky button position: {is_sticky}")
            else:
                results.fail("TC-3036", "Acceptance control must be fixed or sticky", f"Observed {is_sticky}")
        else:
            results.fail("TC-3036", "Acceptance control position", "No identified acceptance control to measure")

        # ══════════════════════════════════════════════════════════════
        #  Spec §3: Accept order flow
        # ══════════════════════════════════════════════════════════════
        print(f"\n{'═'*60}")
        print(f"  Spec §3: Accept order flow")
        print(f"{'═'*60}")

        # The sticky bottom button (Block 7) is the clickable one;
        # the timeline step with the same label is intentionally disabled.
        accept_btn = page.locator(".driver-task-accept-sticky__btn, [data-testid='accept-sticky-bar'] button")
        if accept_btn.count() == 0:
            # Fallback: find the non-disabled one
            all_accept = page.locator("button:has-text('Nhận lệnh vận chuyển')")
            for i in range(all_accept.count()):
                if all_accept.nth(i).is_enabled():
                    accept_btn = all_accept.nth(i)
                    break
        if accept_btn.count() > 0 and accept_btn.first.is_disabled():
            lock_reason = page.get_by_role('status', name='Lô hàng đã khóa kế toán', exact=True)
            if lock_reason.count() > 0 and lock_reason.is_visible():
                results.fail("TC-3040", "Own fixture unexpectedly accounting-locked", f"tripId={selected_trip_id}; {lock_reason.inner_text()}")
            else:
                results.fail("TC-3040", "Acceptance control disabled", f"tripId={selected_trip_id}; no known accounting-lock reason was rendered")
        elif accept_btn.count() > 0:
            with page.expect_response(
                lambda response: urlparse(response.url).path.startswith('/api/driver/me/fulfillments/')
                and urlparse(response.url).path.endswith('/progress')
                and response.request.method == 'POST',
                timeout=15000,
            ) as acceptance:
                accept_btn.first.click()
            acceptance_status = acceptance.value.status
            acceptance_detail = acceptance.value.text()[:500] if acceptance_status not in (200, 201) else ""
            ctx.screenshot(page, "TC-3040_after_accept")

            # TC-3040: After accept, check if order moved
            page.goto(f"{BASE_URL}/my-trips")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(1500)

            # Check "Đã nhận" tab
            running_tab = page.locator("button:has-text('Đã nhận')")
            if running_tab.count() > 0:
                running_tab.first.click()
                page.wait_for_timeout(1000)
                running_cards = page.locator(".driver-journey-card")
                board_response = ctx.api.get('/api/driver/me/journey-board')
                board = board_response.get('data', {})
                selected = next((row for row in board.get('items', [])
                                 if str(row.get('tripId')) == selected_trip_id), None)
                trip_code = selected.get('tripCode') if selected else None
                matching_cards = running_cards.filter(has_text=trip_code) if trip_code else None
                if acceptance_status in (200, 201) and board_response.get('status') == 200 and selected and selected.get('bucket') == 'RUNNING' \
                        and matching_cards is not None and matching_cards.count() > 0:
                    results.pass_("TC-3040", "Clicked order appears in 'Đã nhận'", f"tripId={selected_trip_id}, tripCode={trip_code}, bucket=RUNNING")
                else:
                    results.fail("TC-3040", "Clicked order did not appear in 'Đã nhận'", f"tripId={selected_trip_id}, acceptance={acceptance_status}, response={acceptance_detail}, boardAPI={board_response.get('status')}, bucket={selected.get('bucket') if selected else None}, renderedCards={running_cards.count()}")
                ctx.screenshot(page, "TC-3040_running_tab")
            else:
                results.fail("TC-3040", "Đã nhận tab", "Tab not found")
        else:
            results.fail("TC-3040", "Accept flow", "No accept button for own fixture")

    else:
        results.fail("TC-3030-TC-3040", "Detail + Accept", "Own fixture card missing")

    # ════════════════════════════════════════════════════════════════
    #  Visual Quality
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Visual Quality")
    print(f"{'═'*60}")

    # TC-3050: No horizontal overflow (mobile)
    page.goto(f"{BASE_URL}/my-trips")
    page.wait_for_load_state("networkidle")
    # Reload defaults to Lệnh mới; the accepted fixture now belongs to Đã nhận.
    page.locator("button:has-text('Đã nhận')").click()
    typography_card = page.locator(".driver-journey-card").filter(has_text=fixture["trip"]["tripCode"])
    typography_card.wait_for(state="visible", timeout=15000)
    overflow = page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    if overflow:
        results.pass_("TC-3050", "No horizontal overflow (390px)")
    else:
        results.fail("TC-3050", "Horizontal overflow on mobile")

    # Approved compact scale: body/data/controls 12px, captions 11px.
    typography = typography_card.evaluate("""card => ({
        body: parseFloat(getComputedStyle(document.body).fontSize),
        useful: [...card.querySelectorAll('.driver-journey-card__route, .driver-journey-card__footer')]
            .filter(el => el.getBoundingClientRect().height > 0)
            .map(el => parseFloat(getComputedStyle(el).fontSize))
    })""")
    if typography["body"] >= 12 and typography["useful"] and min(typography["useful"]) >= 12:
        results.pass_("TC-3051", "Compact mobile body and useful card text ≥12px")
    else:
        results.fail("TC-3051", "Mobile typography below the approved scale", str(typography))

    # TC-3052: Touch targets ≥ 40px
    touch = page.evaluate("""() => {
        const btns = document.querySelectorAll('button, a, [role="button"]');
        let small = 0;
        for (const b of btns) {
            const r = b.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40)) small++;
        }
        return { total: btns.length, small };
    }""")
    if touch["small"] <= 3:
        results.pass_("TC-3052", f"Touch targets OK: {touch['total']} buttons, {touch['small']} small")
    else:
        results.fail("TC-3052", f"{touch['small']}/{touch['total']} buttons < 40px")

    # TC-3053: Sidebar hidden on mobile
    sidebar_in_view = page.locator("aside.sidebar").evaluate_all("""elements => elements.some(el => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0
            && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    })""")
    if sidebar_in_view:
        results.fail("TC-3053", "Sidebar intersects driver mobile viewport")
    else:
        results.pass_("TC-3053", "Sidebar absent from driver mobile viewport")

    # Desktop viewport
    page.close()
    page = ctx.new_page(viewport={"width": 1280, "height": 900})
    ctx.login_as("driver", page)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    ctx.screenshot(page, "TC-3054_driver_desktop")
    overflow_d = page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    if overflow_d:
        results.pass_("TC-3054", "No horizontal overflow (1280px)")
    else:
        results.fail("TC-3054", "Horizontal overflow on desktop")
    page.close()

    # ════════════════════════════════════════════════════════════════
    #  History tab
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  History tab")
    print(f"{'═'*60}")

    page = ctx.new_page(viewport={"width": 390, "height": 844})
    ctx.login_as("driver", page)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)

    history_tab = page.locator("button:has-text('Lịch sử')")
    if history_tab.count() > 0:
        history_tab.first.click()
        page.wait_for_timeout(1000)
        history_cards = page.locator(".driver-journey-card")
        if history_cards.count() > 0:
            results.pass_("TC-3060", f"Lịch sử tab: {history_cards.count()} completed trip(s)")
        else:
            empty_history = page.locator('.driver-journey__empty').filter(has_text='Chưa có chuyến')
            if empty_history.count() > 0 and empty_history.first.is_visible():
                results.pass_("TC-3060", "History shows its empty state", empty_history.first.inner_text())
            else:
                results.fail("TC-3060", "History content", "Neither completed cards nor a visible empty-history state was rendered")
        ctx.screenshot(page, "TC-3060_history_tab")
    else:
        results.fail("TC-3060", "Lịch sử tab", "Tab not found")
    page.close()

    results.pass_("TC-3099", "Visual QA reached its final step; see individual case outcomes")


def test_visual_driver(ctx: SilverseaTestContext, results: TestResults):
    fixture = create_driver_flow_fixture(ctx, results)
    if fixture is None:
        return
    try:
        verify_visual_driver(ctx, results, fixture)
    finally:
        cleanup_driver_flow_fixture(fixture, results)


if __name__ == "__main__":
    sys.exit(run_suite("test_20_visual_driver", test_visual_driver, headless=True))
