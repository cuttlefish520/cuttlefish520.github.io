/* The source drawing remains intact. Only the sky and unoccupied sea are animated. */
(() => {
  'use strict'

  const background = document.getElementById('coastal-background')
  const canvas = document.getElementById('coastal-canvas')
  if (!background || !canvas || window.coastalScene) return

  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
  const preference = {
    read (key, fallback) {
      try { return localStorage.getItem(`coast-${key}`) || fallback } catch { return fallback }
    },
    write (key, value) {
      try { localStorage.setItem(`coast-${key}`, value) } catch { /* Private browsing can deny storage. */ }
    }
  }

  const state = {
    motion: preference.read('motion', 'on') !== 'off',
    color: preference.read('color', 'color') !== 'mono',
    ready: false,
    images: {},
    width: 0,
    height: 0,
    dpr: 1,
    frame: 0,
    time: 0,
    lastTick: 0,
    animation: 0,
    pointer: { x: 0, y: 0 },
    offset: { x: 0, y: 0 }
  }

  // Even-odd holes keep the water distortion off faces, bodies and clothes.
  const water = new Path2D(`
    M396 245 Q780 197 1170 250 T1573 260 V739
    Q1170 785 800 713 T396 765 Z
    M423 475 L448 474 483 489 535 458 536 402 566 360 612 360
    655 410 651 453 693 494 700 535 657 549 688 576 673 608
    632 613 612 599 575 597 534 566 477 590 427 557 Z
    M737 246 L811 238 842 299 850 331 880 400 887 491 917 566
    904 593 869 582 866 633 900 675 901 710 854 716
    820 693 801 650 779 623 738 594 732 537 724 482 725 385 Z
    M1071 243 L1154 243 1176 331 1190 381 1243 455 1282 486
    1283 524 1237 532 1287 580 1301 615 1301 651 1285 683
    1249 686 1238 656 1185 635 1136 594 1106 643 1093 689
    1066 748 1012 746 1006 702 1040 659 1046 595 1051 535
    1019 520 1002 477 998 421 1030 415 1074 366 Z
    M1341 274 L1409 269 1444 301 1447 354 1459 405 1470 463
    1495 521 1483 566 1480 620 1485 692 1505 724 1494 754
    1452 756 1425 720 1430 773 1444 817 1430 852 1371 853
    1360 811 1351 763 1344 713 1328 654 1323 603 1288 535
    1293 493 1325 438 1320 388 Z
  `)
  const sky = new Path2D(`
    M396 0 H1573 V157 L1440 150 1340 159 1200 141 1100 134
    1000 145 920 127 818 77 730 67 622 122 545 125 396 176 Z
  `)

  const glints = Array.from({ length: 48 }, (_, i) => ({
    x: 420 + ((i * 173 + 61) % 1110),
    y: 275 + ((i * 79 + 19) % 443),
    width: 7 + (i * 13) % 42,
    phase: i * 2.399
  }))

  const loadImage = url => new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Background image could not be loaded'))
    image.src = url
  })

  const isMoving = () => state.ready && state.motion && !reducedMotion.matches && !document.hidden

  function syncControls () {
    const motion = document.getElementById('scene-motion-toggle')
    const color = document.getElementById('scene-color-toggle')
    const theme = document.getElementById('scene-theme-toggle')
    const moving = state.motion && !reducedMotion.matches
    const dark = document.documentElement.dataset.theme === 'dark'
    if (motion) {
      const label = reducedMotion.matches ? '系统已启用减少动态效果' : moving ? '暂停背景动画' : '播放背景动画'
      motion.disabled = !state.ready || reducedMotion.matches
      motion.setAttribute('aria-pressed', String(moving))
      motion.setAttribute('aria-label', label)
      motion.title = label
      motion.firstElementChild.className = `fas fa-${moving ? 'pause' : 'play'}`
    }
    if (color) {
      const label = state.color ? '切换为黑白原稿' : '切换为彩色场景'
      color.disabled = !state.images.original || !state.ready
      color.setAttribute('aria-pressed', String(state.color))
      color.setAttribute('aria-label', label)
      color.title = label
    }
    if (theme) {
      const label = dark ? '切换浅色模式' : '切换深色模式'
      theme.setAttribute('aria-pressed', String(dark))
      theme.setAttribute('aria-label', label)
      theme.title = label
      theme.firstElementChild.className = dark ? 'far fa-sun' : 'far fa-moon'
    }
    background.dataset.motion = reducedMotion.matches ? 'reduced' : moving ? 'playing' : 'paused'
    background.dataset.colorMode = state.color ? 'color' : 'mono'
  }

  function projection () {
    if (state.width <= 700) {
      const scale = state.width / 1178
      return {
        scale,
        x: -395 * scale,
        y: state.height * .24,
        portrait: true
      }
    }
    const scale = Math.max((state.width + 12) / 1920, (state.height + 12) / 1080)
    return {
      scale,
      x: (state.width - 1920 * scale) / 2 + state.offset.x,
      y: (state.height - 1080 * scale) / 2 + state.offset.y,
      portrait: false
    }
  }

  function paint () {
    if (!state.ready) return
    const image = state.images[state.color ? 'color' : 'original'] || state.images.color
    const view = projection()
    const animated = state.motion && !reducedMotion.matches
    const t = state.time

    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
    context.fillStyle = state.color ? '#bedce0' : '#ededed'
    context.fillRect(0, 0, state.width, state.height)
    if (view.portrait) {
      context.fillStyle = state.color ? '#eee1c2' : '#eee'
      const ground = view.y + 1060 * view.scale
      context.fillRect(0, ground, state.width, state.height - ground)
    }
    context.translate(view.x, view.y)
    context.scale(view.scale, view.scale)
    if (view.portrait) {
      context.drawImage(image, 395, 0, 1178, 1080, 395, 0, 1178, 1080)
    } else {
      context.drawImage(image, 0, 0)
    }

    if (animated) {
      context.save()
      context.clip(sky)
      context.globalAlpha = .26
      const cloudDrift = Math.sin(t * .075) * 18
      context.drawImage(image, 395, 0, 1178, 185, 395 + cloudDrift, 0, 1178, 185)
      context.restore()

      context.save()
      context.clip(water, 'evenodd')
      for (let y = 250; y < 760; y += 7) {
        const depth = (y - 240) / 520
        const shift = Math.sin(y * .038 + t * .72) * (1.4 + depth * 2.1)
        const rise = Math.sin(y * .023 + t * .9) * depth * .8
        context.drawImage(image, 395, y, 1178, 7, 395 + shift, y + rise, 1178, 7.5)
      }
      context.lineCap = 'round'
      for (const glint of glints) {
        const phase = t * .6 + glint.phase
        const x = glint.x + Math.sin(phase * .6) * 9
        const y = glint.y + Math.sin(phase) * 2.6
        const opacity = Math.max(0, Math.sin(phase)) * .35
        context.strokeStyle = `rgba(255, 253, 232, ${opacity})`
        context.lineWidth = .7 + (glint.y - 250) / 450
        context.beginPath()
        context.moveTo(x, y)
        context.quadraticCurveTo(x + glint.width * .45, y - 1.8, x + glint.width, y)
        context.stroke()
      }
      context.restore()
    }

    state.frame++
    if (state.frame % 15 === 0 || state.frame === 1) canvas.dataset.frame = String(state.frame)
  }

  function tick (now) {
    state.animation = 0
    if (!isMoving()) return
    if (!state.lastTick) state.lastTick = now
    if (now - state.lastTick >= 1000 / 30) {
      state.time += Math.min((now - state.lastTick) / 1000, .1)
      state.lastTick = now
      state.offset.x += (state.pointer.x * 3 - state.offset.x) * .045
      state.offset.y += (state.pointer.y * 2 - state.offset.y) * .045
      paint()
    }
    state.animation = requestAnimationFrame(tick)
  }

  function reconcileAnimation () {
    if (state.animation) cancelAnimationFrame(state.animation)
    state.animation = 0
    state.lastTick = 0
    if (!isMoving()) {
      state.offset.x = 0
      state.offset.y = 0
    }
    syncControls()
    paint()
    if (isMoving()) state.animation = requestAnimationFrame(tick)
  }

  function resize () {
    state.width = document.documentElement.clientWidth
    state.height = window.innerHeight
    state.dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(3200000 / (state.width * state.height)))
    canvas.width = Math.round(state.width * state.dpr)
    canvas.height = Math.round(state.height * state.dpr)
    paint()
  }

  function syncPage () {
    const home = Boolean(document.querySelector('.coast-home'))
    const header = document.getElementById('page-header')
    const threshold = header ? header.offsetHeight * .65 : 180
    document.body.classList.toggle('scene-reading', !home || window.scrollY > threshold)
    const current = window.location.pathname.replace(/index\.html$/, '')
    document.querySelectorAll('#nav .menus_item a').forEach(link => {
      const target = new URL(link.href).pathname.replace(/index\.html$/, '')
      const active = target === '/' ? current === '/' : current.startsWith(target)
      if (active) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    })
  }

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return
    const motion = event.target.closest('#scene-motion-toggle')
    const color = event.target.closest('#scene-color-toggle')
    const theme = event.target.closest('#scene-theme-toggle')
    if (motion && !motion.disabled) {
      state.motion = !state.motion
      preference.write('motion', state.motion ? 'on' : 'off')
      reconcileAnimation()
    } else if (color && !color.disabled) {
      state.color = !state.color
      preference.write('color', state.color ? 'color' : 'mono')
      syncControls()
      paint()
    } else if (theme) {
      document.getElementById('darkmode')?.click()
    }
  })

  window.addEventListener('pointermove', event => {
    if (!finePointer.matches || !isMoving()) return
    state.pointer.x = event.clientX / state.width * 2 - 1
    state.pointer.y = event.clientY / state.height * 2 - 1
  }, { passive: true })
  window.addEventListener('pointerout', event => {
    if (event.relatedTarget === null) state.pointer = { x: 0, y: 0 }
  }, { passive: true })
  window.addEventListener('resize', resize, { passive: true })
  window.addEventListener('scroll', syncPage, { passive: true })
  window.addEventListener('pjax:complete', () => {
    syncPage()
    syncControls()
  })
  document.addEventListener('visibilitychange', reconcileAnimation)
  reducedMotion.addEventListener('change', reconcileAnimation)
  new MutationObserver(syncControls).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  })

  // A failed canvas or image leaves the semantic page and static picture usable.
  loadImage(background.dataset.color).then(async image => {
    state.images.color = image
    state.ready = true
    resize()
    background.classList.add('is-ready')
    try {
      state.images.original = await loadImage(background.dataset.original)
    } catch {
      state.color = true
    }
    reconcileAnimation()
  }).catch(() => {
    background.dataset.motion = 'unavailable'
  })

  window.coastalScene = {
    get status () {
      return { ready: state.ready, frames: state.frame, motion: isMoving(), color: state.color }
    }
  }
  syncPage()
  syncControls()
})()
