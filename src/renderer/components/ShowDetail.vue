<template id="ShowDetail">
    <div class="detail-page">
        <main class="detail-shell">
            <section class="hero-overview">
                <div class="header-nav">
                    <router-link to="/" class="back-link">
                        <ChevronLeft class="nav-icon" />
                        返回控制台
                    </router-link>
                    <span class="detail-kicker">英雄情报</span>
                </div>

                <div class="hero-layout">
                    <div class="hero-mark">
                        <span>{{ championInitial }}</span>
                        <small>英雄ID {{ championId || '--' }}</small>
                    </div>

                    <div class="title-copy">
                        <p class="detail-kicker">英雄详情</p>
                        <h1>{{ championDetail?.name || '等待英雄选择' }}</h1>
                        <p>{{ championDetail?.title || '收到英雄选择后展示符文方案、胜率与选取数据。' }}</p>

                        <div class="intel-strip">
                            <div class="intel-item">
                                <span>数据源</span>
                                <strong>{{ type.toUpperCase() }}</strong>
                            </div>
                            <div class="intel-item">
                                <span>方案数</span>
                                <strong>{{ activePerks.length }}</strong>
                            </div>
                            <div class="intel-item">
                                <span>状态</span>
                                <strong>{{ activePerks.length ? '可应用' : '等待数据' }}</strong>
                            </div>
                        </div>
                    </div>

                    <aside class="source-panel">
                        <div class="source-heading">
                            <Database class="source-icon" />
                            <span>数据源</span>
                        </div>
                        <div class="source-tabs" role="tablist" aria-label="数据源">
                            <button :class="{ active: type === 'opgg' }" @click="selectType('opgg')">
                                OP.GG
                            </button>
                            <button :class="{ active: type === 'qq' }" @click="selectType('qq')">
                                QQ
                            </button>
                        </div>
                        <p class="source-note">
                            切换来源不会改变当前英雄，只刷新符文方案展示。
                        </p>
                    </aside>
                </div>
            </section>

            <section class="loadout-panel">
                <div class="panel-header">
                    <div>
                        <p class="detail-kicker">符文方案</p>
                        <h2>推荐符文方案</h2>
                    </div>
                    <div class="panel-meta">
                        <Layers class="meta-icon" />
                        <span>{{ activePerks.length }} 套方案</span>
                    </div>
                </div>

                <div v-if="activePerks.length" class="loadout-list">
                    <article
                        v-for="(perk, index) in activePerks"
                        :key="`${type}-${index}`"
                        class="loadout-row"
                        @mouseenter="showPreview(perk, $event.currentTarget)"
                        @mouseleave="hidePreview"
                    >
                        <div class="row-index">{{ String(index + 1).padStart(2, '0') }}</div>

                        <div class="rune-badge">
                            <img
                                v-if="perk.selectedPerkIds?.[0]"
                                class="perk-img"
                                :src="'/runes/' + perk.selectedPerkIds[0] + '.png'"
                                alt="符文"
                            >
                            <span v-else>--</span>
                        </div>

                        <div class="row-main">
                            <div class="row-title">
                                <strong>{{ perk.position || '通用位置' }}</strong>
                                <span>{{ type.toUpperCase() }}</span>
                            </div>
                            <div class="winrate-track">
                                <div class="winrate-fill" :style="{ width: getWinRateWidth(perk.winRate) }"></div>
                            </div>
                        </div>

                        <div class="row-metrics">
                            <div class="metric">
                                <span>胜率</span>
                                <strong class="winrate">{{ formatWinRate(perk.winRate) }}</strong>
                            </div>
                            <div class="metric">
                                <span>选取</span>
                                <strong>{{ perk.pickCount || '-' }}</strong>
                            </div>
                        </div>

                        <button class="apply-btn" @click="apply(perk)">
                            <Send class="apply-icon" />
                            应用
                        </button>
                    </article>
                </div>

                <div v-else class="empty-state">
                    当前数据源暂无符文方案
                </div>
            </section>
        </main>
    </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { ChevronLeft, Database, Layers, Send } from 'lucide-vue-next'
import config from "../native/config";
import {getChampions} from '../service/qq';
import LCUService from '../service/lcu';
import LolQQ from '../service/data-source/lol-qq';
import Opgg from '../service/data-source/op-gg';
import {getChampionInfo} from './utils';
import { electronAPI } from '../native/electron-api.js'

const type = ref("opgg");
const championId = ref("");
const championDetail = ref({});
const championMap = ref([]);
const qqPerks = ref([]);
const opggPerks = ref([]);
const curPerk = ref({});
const coordinate = ref({x: 0, y: 0, width: 0, height: 0});
let unsubscribeForPopup = null;

const activePerks = computed(() => (type.value === 'qq' ? qqPerks.value : opggPerks.value) || [])
const championInitial = computed(() => championDetail.value?.name?.slice(0, 1) || 'LoL')

const formatWinRate = (value) => {
    if (value == null || value === '') return '--'
    const numeric = Number(value)
    if (Number.isNaN(numeric)) return `${value}%`
    const percent = numeric <= 1 ? numeric * 100 : numeric
    return `${percent.toFixed(1)}%`
}

const getWinRateWidth = (value) => {
    const numeric = Number(value)
    if (Number.isNaN(numeric)) return '0%'
    const percent = numeric <= 1 ? numeric * 100 : numeric
    return `${Math.min(Math.max(percent, 0), 100)}%`
}

const selectType = (typeValue) => {
    type.value = typeValue;
}

const init = async () => {
    const lolVer = config.get(`lolVer`);
    const championList = await getChampions(lolVer);
    championMap.value = championList;
    console.log(championList)

    unsubscribeForPopup = electronAPI.events.on('for-popup', ({championId: id}) => {
        if (id) {
            championId.value = id;
            console.log(`id:${id}`);

            if (!championId.value || !championMap.value) return;

            const champ = getChampionInfo(championId.value, championMap.value);
            if (!champ) {
                championId.value = 0;
                championDetail.value = null;
                return;
            }

            championDetail.value = champ;
            console.log(champ.key)
            console.log(champ.id)
            console.log(championDetail.value)
            const lolqqInstance = new LolQQ();
            lolqqInstance.getChampionPerks(champ.key, champ.id).then((result) => {
                qqPerks.value = (result);
                console.log(qqPerks.value)
            });

            const opggInstance = new Opgg();
            opggInstance.getChampionPerks(champ.id).then((result) => {
                opggPerks.value = (result);
                console.log(result)
            });
        }
    });
}

const apply = async (perk) => {
    console.log("apply");
    const lolVer = config.get(`lolVer`);
    const lolDir = config.get(`lolDir`);
    console.log(`lolVer:${lolVer}`);
    console.log(`lolDir:${lolDir}`);

    try {
        const lcuInstance = new LCUService(lolDir);
        await lcuInstance.getAuthToken();
        const res = await lcuInstance.applyPerk({
            ...perk,
        });
        console.info(`Apply perk`, res);
    } catch (e) {
        console.error(e);
    }
}

const showPreview = (perk, el) => {
    console.log("showPreview");
    curPerk.value = perk;
    if (!el) return;

    const {x, y, width, height} = el.getBoundingClientRect();
    coordinate.value = {x, y, width, height};
}

const hidePreview = () => {
    console.log("hidePreview");
    curPerk.value = {};
}

onMounted(() => {
    console.log("ShowDetail");
    config.set(`test`, `zh-CN`);
    console.log(config.get(`test`));
    init();
});

onBeforeUnmount(() => {
    unsubscribeForPopup?.();
});
</script>

<style scoped>
.detail-page {
    min-height: 100vh;
    padding: 20px;
    color: var(--lol-ivory);
    background:
        linear-gradient(180deg, rgba(40, 217, 200, 0.05), transparent 260px),
        radial-gradient(circle at 82% 6%, rgba(200, 169, 106, 0.12), transparent 320px),
        linear-gradient(180deg, var(--lol-bg-2), var(--lol-bg));
}

.detail-shell {
    max-width: 980px;
    margin: 0 auto;
}

.hero-overview,
.loadout-panel {
    position: relative;
    overflow: hidden;
    background:
        linear-gradient(145deg, rgba(24, 36, 50, 0.9), rgba(7, 10, 13, 0.96)),
        var(--lol-surface);
    border: 1px solid rgba(200, 169, 106, 0.18);
    border-radius: 8px;
    box-shadow: 0 28px 70px rgba(0, 0, 0, 0.42);
}

.hero-overview::before,
.loadout-panel::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(90deg, rgba(40, 217, 200, 0.12), transparent 34%);
    opacity: 0.58;
}

.hero-overview {
    padding: 16px;
    margin-bottom: 14px;
}

.header-nav,
.hero-layout,
.panel-header,
.source-heading,
.row-title,
.row-metrics,
.apply-btn {
    display: flex;
    align-items: center;
}

.header-nav {
    position: relative;
    z-index: 1;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 22px;
}

.back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--lol-muted);
    font-size: 13px;
    text-decoration: none;
}

.back-link:hover {
    color: var(--lol-teal-2);
}

.nav-icon,
.source-icon,
.meta-icon,
.apply-icon {
    width: 16px;
    height: 16px;
}

.detail-kicker {
    margin: 0;
    color: var(--lol-gold-2);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0;
}

.hero-layout {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr) 260px;
    gap: 22px;
    align-items: stretch;
}

.hero-mark {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 140px;
    padding: 14px;
    background:
        radial-gradient(circle at 50% 0%, rgba(40, 217, 200, 0.18), transparent 72%),
        rgba(7, 10, 13, 0.42);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
}

.hero-mark span {
    color: var(--lol-ivory);
    font-size: 54px;
    font-weight: 900;
    line-height: 1;
}

.hero-mark small {
    color: var(--lol-muted);
    font-size: 12px;
    font-weight: 700;
}

.title-copy {
    min-width: 0;
    padding: 6px 0;
}

.title-copy h1 {
    margin: 6px 0 6px;
    color: var(--lol-ivory);
    font-size: 28px;
    font-weight: 900;
    line-height: 1.16;
}

.title-copy p:not(.detail-kicker) {
    max-width: 560px;
    margin: 0;
    color: var(--lol-muted);
    font-size: 14px;
    line-height: 1.7;
}

.intel-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(96px, 1fr));
    gap: 8px;
    max-width: 520px;
    margin-top: 16px;
}

.intel-item {
    padding: 12px;
    background: rgba(7, 10, 13, 0.36);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
}

.intel-item span,
.metric span {
    display: block;
    margin-bottom: 4px;
    color: var(--lol-faint);
    font-size: 11px;
    font-weight: 700;
}

.intel-item strong {
    color: var(--lol-teal-2);
    font-size: 15px;
    font-weight: 900;
}

.source-panel {
    padding: 16px;
    background: rgba(7, 10, 13, 0.34);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
}

.source-heading {
    gap: 8px;
    margin-bottom: 12px;
    color: var(--lol-gold-2);
    font-size: 13px;
    font-weight: 900;
}

.source-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 4px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
}

.source-tabs button {
    min-width: 0;
    padding: 10px 12px;
    color: var(--lol-muted);
    background: transparent;
    border: 0;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 900;
    cursor: pointer;
}

.source-tabs button.active {
    color: var(--lol-bg);
    background: linear-gradient(135deg, var(--lol-teal-2), var(--lol-gold-2));
    box-shadow: 0 10px 28px rgba(40, 217, 200, 0.12);
}

.source-note {
    margin: 12px 0 0;
    color: var(--lol-faint);
    font-size: 12px;
    line-height: 1.6;
}

.loadout-panel {
    padding: 16px;
}

.panel-header {
    position: relative;
    z-index: 1;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}

.panel-header h2 {
    margin: 4px 0 0;
    color: var(--lol-ivory);
    font-size: 18px;
    font-weight: 900;
}

.panel-meta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    color: var(--lol-gold-2);
    background: rgba(200, 169, 106, 0.1);
    border: 1px solid var(--lol-border);
    border-radius: 8px;
    font-size: 12px;
    font-weight: 800;
}

.loadout-list {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.loadout-row {
    display: grid;
    grid-template-columns: 42px 48px minmax(0, 1fr) 210px 96px;
    gap: 12px;
    align-items: center;
    min-height: 64px;
    padding: 10px 12px;
    background: linear-gradient(90deg, rgba(17, 25, 35, 0.72), rgba(7, 10, 13, 0.42));
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
    transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.loadout-row:hover {
    transform: translateY(-1px);
    background: linear-gradient(90deg, rgba(21, 38, 50, 0.82), rgba(7, 10, 13, 0.52));
    border-color: rgba(40, 217, 200, 0.34);
}

.row-index {
    color: var(--lol-gold-2);
    font-size: 12px;
    font-weight: 900;
}

.rune-badge {
    width: 42px;
    height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(7, 10, 13, 0.55);
    border: 1px solid var(--lol-border);
    border-radius: 8px;
    color: var(--lol-faint);
    font-size: 12px;
    font-weight: 800;
}

.perk-img {
    width: 36px;
    height: 36px;
    border-radius: 6px;
    object-fit: cover;
}

.row-main {
    min-width: 0;
}

.row-title {
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
}

.row-title strong {
    color: var(--lol-ivory);
    font-size: 15px;
    font-weight: 900;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.row-title span {
    flex: 0 0 auto;
    padding: 3px 7px;
    color: var(--lol-teal-2);
    background: rgba(40, 217, 200, 0.1);
    border: 1px solid rgba(40, 217, 200, 0.2);
    border-radius: 6px;
    font-size: 10px;
    font-weight: 900;
}

.winrate-track {
    height: 5px;
    overflow: hidden;
    background: rgba(244, 236, 220, 0.08);
    border-radius: 999px;
}

.winrate-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--lol-teal), var(--lol-gold-2));
    border-radius: inherit;
}

.row-metrics {
    justify-content: flex-end;
    gap: 18px;
}

.metric {
    min-width: 70px;
    text-align: right;
}

.metric strong {
    color: var(--lol-ivory);
    font-size: 15px;
    font-weight: 900;
}

.metric .winrate {
    color: var(--lol-success);
}

.apply-btn {
    justify-content: center;
    gap: 6px;
    height: 30px;
    color: var(--lol-bg);
    background: linear-gradient(135deg, var(--lol-teal-2), var(--lol-teal));
    border: 1px solid rgba(108, 241, 229, 0.36);
    border-radius: 6px;
    font-size: 12px;
    font-weight: 900;
    cursor: pointer;
}

.apply-btn:hover {
    box-shadow: var(--lol-glow);
}

.empty-state {
    position: relative;
    z-index: 1;
    padding: 48px 16px;
    color: var(--lol-muted);
    text-align: center;
    border: 1px dashed var(--lol-border);
    border-radius: 8px;
    background: rgba(7, 10, 13, 0.28);
}

@media (max-width: 920px) {
    .hero-layout {
        grid-template-columns: 120px minmax(0, 1fr);
    }

    .source-panel {
        grid-column: 1 / -1;
    }

    .loadout-row {
        grid-template-columns: 36px 44px minmax(0, 1fr) 92px;
    }

    .row-metrics {
        grid-column: 3 / 4;
        justify-content: flex-start;
    }
}

@media (max-width: 640px) {
    .detail-page {
        padding: 12px;
    }

    .hero-layout,
    .intel-strip,
    .loadout-row {
        grid-template-columns: 1fr;
    }

    .hero-mark {
        min-height: 100px;
    }

    .panel-header {
        align-items: flex-start;
        flex-direction: column;
    }

    .row-metrics {
        grid-column: auto;
        justify-content: space-between;
    }
}
</style>
