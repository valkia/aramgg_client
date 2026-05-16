import Vue from 'vue/dist/vue.js'
import Router from 'vue-router'

import Display from '../components/Display'
import ShowDetail from '../components/ShowDetail'

Vue.use(Router);


const routes = [
    {path: '/', name: 'Display', component: Display},
    {path: '/display', name: 'Display', component: Display},
    {path: '/showDetail', name: 'ShowDetail', component: ShowDetail},
]
const router = new Router({
    routes
})
export default router;