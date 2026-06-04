import Vue from 'vue/dist/vue.js'
import Router from 'vue-router'

import Display from '../components/Display'

Vue.use(Router);


const routes = [
    {path: '/', name: 'Display', component: Display},
    {path: '/display', name: 'Display', component: Display},
]
const router = new Router({
    routes
})
export default router;
