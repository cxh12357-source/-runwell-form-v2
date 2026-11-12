// 分类的唯一数据源；业务版本和正式模板后续通过数据库提供。
export const catalog = {
  businesses: [
    { id: 'ipman', name: 'IPMAN' },
    { id: 'premium-line', name: '精品专线' },
    { id: 'business-line', name: '商务专线' },
    { id: 'smart-line', name: '智能专线' }
  ],
  attributes: [
    { id: 'new', name: '新装' },
    { id: 'relocation', name: '移机' },
    { id: 'change', name: '变更' },
    { id: 'termination', name: '拆机' }
  ],
  versions: []
};
